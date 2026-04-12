const mongoose = require("mongoose");
const Project = require("../models/project");
const ProjectMember = require("../models/project_member");
const Task = require("../models/tasks");

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
};
/**
 * POST /projects
 * Admin/Manager only.
 * Also auto-enrolls the manager as a "manager" ProjectMember.
 */
const createProject = async (req, res) => {
  try {
    const { title, description, manager_id, status, priority, start_date, end_date } = req.body;

    if (manager_id && !isValidObjectId(manager_id)) {
      return res.status(400).json({ success: false, message: "Invalid manager_id" });
    }

    const project = await Project.create({
      title,
      description,
      manager_id: manager_id || req.user._id,
      status,
      priority,
      start_date,
      end_date,
    });

    // Auto-add manager as a project member
    await ProjectMember.create({
      project_id: project._id,
      user_id: project.manager_id,
      role_in_project: "manager",
    });

    return res.status(201).json({ success: true, data: project });
  } catch (error) {
    if (error.name === "ValidationError" || error.message.includes("end_date")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── GET ALL PROJECTS ────────────────────────────────────────────────────────

/**
 * GET /projects
 * Admins see all. Managers see their managed projects. Employees see their member projects.
 * Query: ?status= &priority= &page= &limit= &search=
 */
const getAllProjects = async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 20, search } = req.query;
    const { role, _id: userId } = req.user;

    let filter = {};

    // Scope to relevant projects if not admin
    if (role === "manager") {
      filter.manager_id = userId;
    } else if (role === "employee") {
      const memberships = await ProjectMember.find({ user_id: userId, status: "active" }).select("project_id");
      const projectIds = memberships.map((m) => m.project_id);
      filter._id = { $in: projectIds };
    }

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate("manager_id", "name email designation")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Project.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: projects,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET PROJECT BY ID ───────────────────────────────────────────────────────

/**
 * GET /projects/:id
 * Returns project with members and task summary counts.
 */
const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid project ID" });
    }

    const project = await Project.findById(id).populate("manager_id", "name email designation department");

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    // Verify requesting employee is a member
    if (req.user.role === "employee") {
      const isMember = await ProjectMember.exists({ project_id: id, user_id: req.user._id, status: "active" });
      if (!isMember) {
        return res.status(403).json({ success: false, message: "You are not a member of this project" });
      }
    }

    const [members, taskStats] = await Promise.all([
      ProjectMember.find({ project_id: id, status: "active" }).populate("user_id", "name email designation"),
      Task.aggregate([
        { $match: { project_id: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const taskSummary = taskStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

    return res.status(200).json({
      success: true,
      data: { ...project.toObject(), members, task_summary: taskSummary },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE PROJECT ──────────────────────────────────────────────────────────

/**
 * PATCH /projects/:id
 * Admin or the project's manager only.
 * Auto-sets completed_at on status → "completed".
 */
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid project ID" });
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    // Only admin or the assigned manager may edit
    const isAdmin = req.user.role === "admin";
    const isManager = project.manager_id.toString() === req.user._id.toString();
    if (!isAdmin && !isManager) {
      return res.status(403).json({ success: false, message: "Not authorised to update this project" });
    }

    const updates = { ...req.body };
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Auto-manage completed_at
    if (updates.status === "completed") {
      updates.completed_at = updates.completed_at ?? new Date();
    } else if (updates.status && updates.status !== "completed") {
      updates.completed_at = null;
    }

    // Run the pre-save end_date validation manually for findByIdAndUpdate
    if (updates.end_date || updates.start_date) {
      const newStart = updates.start_date ? new Date(updates.start_date) : project.start_date;
      const newEnd = updates.end_date ? new Date(updates.end_date) : project.end_date;
      if (newEnd <= newStart) {
        return res.status(400).json({ success: false, message: "end_date must be after start_date" });
      }
    }

    const updated = await Project.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("manager_id", "name email");

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── DELETE PROJECT ──────────────────────────────────────────────────────────

/**
 * DELETE /projects/:id
 * Admin only — removes project along with its members and tasks.
 */
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid project ID" });
    }

    const project = await Project.findByIdAndDelete(id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    // Cascade-delete related data
    await Promise.all([
      ProjectMember.deleteMany({ project_id: id }),
      Task.deleteMany({ project_id: id }),
    ]);

    return res.status(200).json({ success: true, message: "Project and related data deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── PROJECT STATS ───────────────────────────────────────────────────────────

/**
 * GET /projects/stats
 * Admin/Manager — project counts by status and priority.
 */
const getProjectStats = async (req, res) => {
  try {
    const matchStage = req.user.role === "manager" ? { manager_id: req.user._id } : {};

    const [byStatus, byPriority] = await Promise.all([
      Project.aggregate([{ $match: matchStage }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Project.aggregate([{ $match: matchStage }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    ]);

    const toMap = (arr) => arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

    return res.status(200).json({
      success: true,
      data: {
        by_status: toMap(byStatus),
        by_priority: toMap(byPriority),
        total: await Project.countDocuments(matchStage),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = { createProject, getAllProjects, getProjectById, updateProject, deleteProject, getProjectStats };