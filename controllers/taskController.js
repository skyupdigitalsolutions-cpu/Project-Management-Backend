const Task = require('../models/tasks');
const mongoose = require("mongoose");

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
  });
};

// ─── CREATE ─────────────────────────────────────────────────────────────────

/**
 * POST /tasks
 * Create a new task
 */
const createTask = async (req, res) => {
  try {
    const {
      project_id,
      title,
      description,
      assigned_to,
      assigned_by,
      status,
      priority,
      due_date,
    } = req.body;

    // Validate required ObjectId references
    if (!isValidObjectId(project_id))
      return res.status(400).json({ success: false, message: "Invalid project_id" });

    if (!isValidObjectId(assigned_to))
      return res.status(400).json({ success: false, message: "Invalid assigned_to" });

    const task = await Task.create({
      project_id,
      title,
      description,
      assigned_to,
      assigned_by,
      status,
      priority,
      due_date,
    });

    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── READ ALL ────────────────────────────────────────────────────────────────

/**
 * GET /tasks
 * Fetch all tasks with optional filters:
 *   ?project_id=  &assigned_to=  &status=  &priority=  &page=  &limit=
 */
const getAllTasks = async (req, res) => {
  try {
    const { project_id, assigned_to, status, priority, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (project_id) {
      if (!isValidObjectId(project_id))
        return res.status(400).json({ success: false, message: "Invalid project_id" });
      filter.project_id = project_id;
    }
    if (assigned_to) {
      if (!isValidObjectId(assigned_to))
        return res.status(400).json({ success: false, message: "Invalid assigned_to" });
      filter.assigned_to = assigned_to;
    }
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const skip = (Number(page) - 1) * Number(limit);

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate("project_id", "name")
        .populate("assigned_to", "name email")
        .populate("assigned_by", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Task.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: tasks,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── READ ONE ────────────────────────────────────────────────────────────────

/**
 * GET /tasks/:id
 * Fetch a single task by ID
 */
const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid task ID" });

    const task = await Task.findById(id)
      .populate("project_id", "name")
      .populate("assigned_to", "name email")
      .populate("assigned_by", "name email");

    if (!task)
      return res.status(404).json({ success: false, message: "Task not found" });

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────

/**
 * PATCH /tasks/:id
 * Partially update a task.
 * Automatically sets completed_at when status changes to "completed",
 * and clears it when status moves away from "completed".
 */
const updateTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid task ID" });

    const updates = { ...req.body };

    // Prevent accidental ID overwrites
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Auto-manage completed_at based on status transition
    if (updates.status === "completed") {
      updates.completed_at = updates.completed_at ?? new Date();
    } else if (updates.status && updates.status !== "completed") {
      updates.completed_at = null;
    }

    const task = await Task.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate("project_id", "name")
      .populate("assigned_to", "name email")
      .populate("assigned_by", "name email");

    if (!task)
      return res.status(404).json({ success: false, message: "Task not found" });

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────

/**
 * DELETE /tasks/:id
 * Hard-delete a task
 */
const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid task ID" });

    const task = await Task.findByIdAndDelete(id);

    if (!task)
      return res.status(404).json({ success: false, message: "Task not found" });

    return res.status(200).json({ success: true, message: "Task deleted successfully" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── BULK STATUS UPDATE ──────────────────────────────────────────────────────

/**
 * PATCH /tasks/bulk-status
 * Update status for multiple tasks at once.
 * Body: { ids: [...], status: "..." }
 */
const bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ success: false, message: "ids must be a non-empty array" });

    if (!ids.every(isValidObjectId))
      return res.status(400).json({ success: false, message: "One or more invalid task IDs" });

    const validStatuses = ["todo", "in-progress", "completed", "on-hold", "cancelled"];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(", ")}` });

    const setFields = { status };
    if (status === "completed") setFields.completed_at = new Date();
    else setFields.completed_at = null;

    const result = await Task.updateMany(
      { _id: { $in: ids } },
      { $set: setFields },
      { runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} task(s) updated`,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── STATS ───────────────────────────────────────────────────────────────────

/**
 * GET /tasks/stats?project_id=
 * Returns task counts grouped by status for a project (or globally)
 */
const getTaskStats = async (req, res) => {
  try {
    const { project_id } = req.query;

    const match = {};
    if (project_id) {
      if (!isValidObjectId(project_id))
        return res.status(400).json({ success: false, message: "Invalid project_id" });
      match.project_id = new mongoose.Types.ObjectId(project_id);
    }

    const stats = await Task.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    // Shape into a flat object: { todo: 4, "in-progress": 2, ... }
    const summary = stats.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  bulkUpdateStatus,
  getTaskStats,
};