const mongoose = require("mongoose");
const Assignment = require("../models/assignment");
const AssignmentMember = require("../models/assignment_member");
const Task = require("../models/tasks");
const Project = require("../models/project");
const ProjectMember = require("../models/project_member");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
};

// ─── WIZARD — Create full project with assignments + members + tasks ──────────
const createProjectWizard = async (req, res) => {
  let createdProjectId = null;

  try {
    const { project: projectData, assignments: assignmentsData = [] } = req.body;

    if (!projectData) {
      return res.status(400).json({ success: false, message: "project data is required" });
    }

    // 1. Create the project
    const project = await Project.create({
      ...projectData,
      manager_id: projectData.manager_id || req.user._id,
    });
    createdProjectId = project._id;

    // 2. Auto-enroll manager as project member
    await ProjectMember.create({
      project_id: project._id,
      user_id: project.manager_id,
      role_in_project: "manager",
    });

    const createdAssignments = [];

    for (const aData of assignmentsData) {
      const { members = [], tasks = [], ...assignmentFields } = aData;

      // 3. Create the assignment
      const assignment = await Assignment.create({
        ...assignmentFields,
        project_id: project._id,
      });

      // 4. Add members to assignment
      const memberDocs = members.map((userId) => ({
        assignment_id: assignment._id,
        user_id: userId,
      }));
      if (memberDocs.length) {
        await AssignmentMember.insertMany(memberDocs, { ordered: false }).catch((e) => {
          if (e.code !== 11000) throw e;
        });

        // Also add them as project members (ignore duplicates)
        const projMemberDocs = members.map((userId) => ({
          project_id: project._id,
          user_id: userId,
          role_in_project: "developer",
        }));
        await ProjectMember.insertMany(projMemberDocs, { ordered: false }).catch((e) => {
          if (e.code !== 11000) throw e;
        });
      }

      // 5. Create tasks for this assignment
      const taskDocs = tasks.map((t) => ({
        ...t,
        project_id: project._id,
        assignment_id: assignment._id,
        assigned_by: req.user._id,
      }));
      const createdTasks = taskDocs.length ? await Task.insertMany(taskDocs) : [];

      createdAssignments.push({ assignment, memberCount: members.length, taskCount: createdTasks.length });
    }

    return res.status(201).json({
      success: true,
      message: `Project created with ${createdAssignments.length} assignment(s)`,
      data: { project, assignments: createdAssignments },
    });
  } catch (error) {
    // Cleanup if something failed mid-way
    if (createdProjectId) {
      await Promise.allSettled([
        Project.findByIdAndDelete(createdProjectId),
        ProjectMember.deleteMany({ project_id: createdProjectId }),
        Assignment.deleteMany({ project_id: createdProjectId }),
        Task.deleteMany({ project_id: createdProjectId }),
      ]);
    }
    console.error("Project Wizard Error:", error.message);
    if (error.name === "ValidationError" || (error.message && error.message.includes("end_date"))) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── CREATE SINGLE ASSIGNMENT ─────────────────────────────────────────────────
const createAssignment = async (req, res) => {
  try {
    const { project_id, department, title, description, start_date, end_date, status, estimated_hours } = req.body;
    if (!isValidObjectId(project_id))
      return res.status(400).json({ success: false, message: "Invalid project_id" });

    const assignment = await Assignment.create({
      project_id, department, title, description, start_date, end_date, status, estimated_hours,
    });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    if (error.name === "ValidationError" || error.message.includes("end_date"))
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── GET ALL ASSIGNMENTS (for a project) ─────────────────────────────────────
const getAssignments = async (req, res) => {
  try {
    const { project_id, status } = req.query;
    const filter = {};
    if (project_id) {
      if (!isValidObjectId(project_id))
        return res.status(400).json({ success: false, message: "Invalid project_id" });
      filter.project_id = project_id;
    }
    if (status) filter.status = status;

    const assignments = await Assignment.find(filter)
      .populate("project_id", "title")
      .sort({ start_date: 1 });

    const enriched = await Promise.all(
      assignments.map(async (a) => {
        const [members, taskCount] = await Promise.all([
          AssignmentMember.find({ assignment_id: a._id })
            .populate("user_id", "name email department designation"),
          Task.countDocuments({ assignment_id: a._id }),
        ]);
        return { ...a.toObject(), members, task_count: taskCount };
      })
    );

    return res.status(200).json({ success: true, total: enriched.length, data: enriched });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET ASSIGNMENT BY ID ─────────────────────────────────────────────────────
const getAssignmentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const assignment = await Assignment.findById(id).populate("project_id", "title start_date end_date");
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    const [members, tasks] = await Promise.all([
      AssignmentMember.find({ assignment_id: id })
        .populate("user_id", "name email department designation"),
      Task.find({ assignment_id: id })
        .populate("assigned_to", "name email")
        .populate("assigned_by", "name email")
        .sort({ due_date: 1 }),
    ]);

    return res.status(200).json({
      success: true,
      data: { ...assignment.toObject(), members, tasks },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE ASSIGNMENT ────────────────────────────────────────────────────────
const updateAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const updates = { ...req.body };
    delete updates._id; delete updates.createdAt; delete updates.updatedAt;

    const assignment = await Assignment.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    return res.status(200).json({ success: true, data: assignment });
  } catch (error) {
    if (error.name === "ValidationError")
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── DELETE ASSIGNMENT ────────────────────────────────────────────────────────
const deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const assignment = await Assignment.findByIdAndDelete(id);
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    await Promise.all([
      AssignmentMember.deleteMany({ assignment_id: id }),
      Task.deleteMany({ assignment_id: id }),
    ]);

    return res.status(200).json({ success: true, message: "Assignment and related data deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── ADD MEMBER TO ASSIGNMENT ─────────────────────────────────────────────────
const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, role_in_assignment, allocated_hours } = req.body;
    if (!isValidObjectId(id) || !isValidObjectId(user_id))
      return res.status(400).json({ success: false, message: "Invalid ID(s)" });

    const member = await AssignmentMember.create({ assignment_id: id, user_id, role_in_assignment, allocated_hours });
    await member.populate("user_id", "name email department designation");
    return res.status(201).json({ success: true, data: member });
  } catch (error) {
    if (error.code === 11000)
      return res.status(400).json({ success: false, message: "User already in this assignment" });
    return handleError(res, error);
  }
};

// ─── REMOVE MEMBER FROM ASSIGNMENT ───────────────────────────────────────────
const removeMember = async (req, res) => {
  try {
    const { id, user_id } = req.params;
    const deleted = await AssignmentMember.findOneAndDelete({ assignment_id: id, user_id });
    if (!deleted)
      return res.status(404).json({ success: false, message: "Member not found in assignment" });
    return res.status(200).json({ success: true, message: "Member removed" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET TASKS FOR ASSIGNMENT ─────────────────────────────────────────────────
const getAssignmentTasks = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const tasks = await Task.find({ assignment_id: id })
      .populate("assigned_to", "name email department")
      .populate("assigned_by", "name email")
      .sort({ due_date: 1 });

    return res.status(200).json({ success: true, total: tasks.length, data: tasks });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createProjectWizard,
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  addMember,
  removeMember,
  getAssignmentTasks,
};