const mongoose       = require("mongoose");
const Assignment     = require("../models/assignment");
const AssignmentMember = require("../models/assignment_member");
const Task           = require("../models/tasks");
const Project        = require("../models/project");
const ProjectMember  = require("../models/project_member");
const User           = require("../models/users");
const Notification   = require("../models/notification");
const {
  autoAssignProjectTasks,
  PROJECT_TYPE_ROLES,
} = require("../services/autoAssignService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
  });
};

// ─── WIZARD — Create full project with auto-assigned tasks ──────────────────
/**
 * POST /api/assignments/wizard
 *
 * Extended wizard: if `auto_assign: true` is passed in project data,
 * the engine will automatically assign tasks to best-fit employees based
 * on project_type and employee roles, without manual member selection.
 *
 * Body shape:
 * {
 *   project: { title, description, priority, start_date, end_date, project_type, ... },
 *   assignments: [
 *     {
 *       department, title, description, start_date, end_date, estimated_hours,
 *       members: [...userIds],          // optional if auto_assign=true
 *       tasks: [
 *         { title, description, priority, due_date, estimated_hours,
 *           required_role, requires_permission, permission_description }
 *       ]
 *     }
 *   ],
 *   auto_assign: true   // triggers smart assignment engine
 * }
 */
const createProjectWizard = async (req, res) => {
  let createdProjectId = null;

  try {
    const {
      project: projectData,
      assignments: assignmentsData = [],
      auto_assign = false,
    } = req.body;

    if (!projectData)
      return res.status(400).json({ success: false, message: "project data is required" });

    // 1. Create the project
    const project = await Project.create({
      ...projectData,
      manager_id: projectData.manager_id || req.user._id,
    });
    createdProjectId = project._id;

    // 2. Auto-enroll manager
    await ProjectMember.create({
      project_id:      project._id,
      user_id:         project.manager_id,
      role_in_project: "manager",
    });

    // ── If auto_assign requested, use the smart engine ─────────────────────
    if (auto_assign) {
      // Determine roles needed from project_type
      const roleMappings = PROJECT_TYPE_ROLES[project.project_type] || PROJECT_TYPE_ROLES.website;

      // Find all active employees whose designation matches the required roles
      const allTaskDrafts = [];

      for (const aData of assignmentsData) {
        const { tasks = [], ...assignmentFields } = aData;

        const assignment = await Assignment.create({
          ...assignmentFields,
          project_id: project._id,
        });

        // For each task, find best fit employee from DB
        for (const taskDraft of tasks) {
          // Map department from role if not specified
          if (!taskDraft.required_role && !taskDraft.required_department) {
            const roleEntry = roleMappings.find((r) =>
              taskDraft.title?.toLowerCase().includes(r.role.split(" ")[0])
            );
            if (roleEntry) {
              taskDraft.required_role       = roleEntry.role;
              taskDraft.required_department = roleEntry.department;
            }
          }
          taskDraft.assignment_id = assignment._id;
          allTaskDrafts.push(taskDraft);
        }
      }

      const createdTasks = await autoAssignProjectTasks(
        project, allTaskDrafts, req.user._id
      );

      return res.status(201).json({
        success: true,
        message: `Project auto-created with ${createdTasks.length} auto-assigned task(s)`,
        data: { project, tasks: createdTasks },
      });
    }

    // ── Manual wizard (original behaviour) ───────────────────────────────
    const createdAssignments = [];

    for (const aData of assignmentsData) {
      const { members = [], tasks = [], ...assignmentFields } = aData;

      const assignment = await Assignment.create({
        ...assignmentFields,
        project_id: project._id,
      });

      const memberDocs = members.map((userId) => ({
        assignment_id: assignment._id,
        user_id:       userId,
      }));
      if (memberDocs.length) {
        await AssignmentMember.insertMany(memberDocs, { ordered: false }).catch((e) => {
          if (e.code !== 11000) throw e;
        });

        const projMemberDocs = members.map((userId) => ({
          project_id:      project._id,
          user_id:         userId,
          role_in_project: "developer",
        }));
        await ProjectMember.insertMany(projMemberDocs, { ordered: false }).catch((e) => {
          if (e.code !== 11000) throw e;
        });
      }

      const PRIORITY_SCORE = { critical: 100, high: 75, medium: 50, low: 25 };
      const taskDocs = tasks.map((t) => ({
        ...t,
        project_id:  project._id,
        assignment_id: assignment._id,
        assigned_by: req.user._id,
        priority_score: PRIORITY_SCORE[t.priority || "medium"] || 50,
        permission_status: t.requires_permission ? "pending" : "not_required",
        status: t.requires_permission ? "blocked" : (t.status || "todo"),
      }));
      const createdTasks = taskDocs.length ? await Task.insertMany(taskDocs) : [];

      // Notify assigned employees
      for (const task of createdTasks) {
        if (task.assigned_to) {
          await Notification.create({
            user_id:   task.assigned_to,
            sender_id: req.user._id,
            message:   `You have been assigned a new task: "${task.title}"`,
            type:      "task_assigned",
            ref_id:    task._id,
            ref_type:  "Task",
          }).catch(console.error);
        }
      }

      createdAssignments.push({
        assignment,
        memberCount: members.length,
        taskCount:   createdTasks.length,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Project created with ${createdAssignments.length} assignment(s)`,
      data: { project, assignments: createdAssignments },
    });
  } catch (error) {
    if (createdProjectId) {
      await Promise.allSettled([
        Project.findByIdAndDelete(createdProjectId),
        ProjectMember.deleteMany({ project_id: createdProjectId }),
        Assignment.deleteMany({ project_id: createdProjectId }),
        Task.deleteMany({ project_id: createdProjectId }),
      ]);
    }
    console.error("Project Wizard Error:", error.message);
    if (error.name === "ValidationError" || error.message?.includes("end_date"))
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── SINGLE ASSIGNMENT CREATE ────────────────────────────────────────────────

const createAssignment = async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!isValidObjectId(project_id))
      return res.status(400).json({ success: false, message: "Invalid project_id" });

    const assignment = await Assignment.create({ ...req.body });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) {
    if (error.name === "ValidationError")
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── GET ASSIGNMENTS ─────────────────────────────────────────────────────────

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
      .populate("project_id", "title status priority project_type")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: assignments });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET SINGLE ASSIGNMENT WITH MEMBERS + TASKS ──────────────────────────────

const getAssignmentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const [assignment, members, tasks] = await Promise.all([
      Assignment.findById(id).populate("project_id", "title status priority project_type"),
      AssignmentMember.find({ assignment_id: id })
        .populate("user_id", "name email department designation status"),
      Task.find({ assignment_id: id })
        .populate("assigned_to", "name email department designation")
        .sort({ priority_score: -1 }),
    ]);

    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    return res.status(200).json({
      success: true,
      data: { assignment, members, tasks },
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
    delete updates._id;
    delete updates.project_id;

    const assignment = await Assignment.findByIdAndUpdate(
      id, { $set: updates }, { new: true, runValidators: true }
    );

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

    await Promise.all([
      Assignment.findByIdAndDelete(id),
      AssignmentMember.deleteMany({ assignment_id: id }),
      Task.deleteMany({ assignment_id: id }),
    ]);

    return res.status(200).json({ success: true, message: "Assignment deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── ADD MEMBER ──────────────────────────────────────────────────────────────

const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    if (!isValidObjectId(id) || !isValidObjectId(user_id))
      return res.status(400).json({ success: false, message: "Invalid IDs" });

    const assignment = await Assignment.findById(id);
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    const member = await AssignmentMember.create({
      assignment_id: id, user_id,
    });

    return res.status(201).json({ success: true, data: member });
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ success: false, message: "Member already in assignment" });
    return handleError(res, error);
  }
};

// ─── REMOVE MEMBER ────────────────────────────────────────────────────────────

const removeMember = async (req, res) => {
  try {
    const { id, user_id } = req.params;
    if (!isValidObjectId(id) || !isValidObjectId(user_id))
      return res.status(400).json({ success: false, message: "Invalid IDs" });

    await AssignmentMember.findOneAndDelete({ assignment_id: id, user_id });
    return res.status(200).json({ success: true, message: "Member removed" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET ASSIGNMENT TASKS ────────────────────────────────────────────────────

const getAssignmentTasks = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const tasks = await Task.find({ assignment_id: id })
      .populate("assigned_to", "name email department designation status")
      .populate("assigned_by", "name email")
      .sort({ priority_score: -1, due_date: 1 });

    return res.status(200).json({ success: true, data: tasks });
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
