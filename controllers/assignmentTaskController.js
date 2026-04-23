

const mongoose = require("mongoose");
const Assignment = require("../models/assignment");
const Project = require("../models/project");
const Task = require("../models/tasks");
const User = require("../models/users");
const Notification = require("../models/notification");

const { generateTasksForAssignment, getSupportedTypes } = require("../services/taskGenerationService");
const { smartAssignTasks, getWorkloadSummary, DEFAULT_DAILY_HOURS } = require("../services/smartAssignmentService");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── GET /api/assignments/supported-types ────────────────────────────────────


const getSupportedAssignmentTypes = async (req, res) => {
  try {
    const { ASSIGNMENT_TASK_TEMPLATES } = require("../services/taskGenerationService");

    const result = {};
    for (const [type, templates] of Object.entries(ASSIGNMENT_TASK_TEMPLATES)) {
      result[type] = {
        taskCount: templates.length,
        totalEstimatedHours: templates.reduce((s, t) => s + t.estimatedHours, 0),
        tasks: templates.map((t) => ({
          title: t.title,
          estimatedHours: t.estimatedHours,
          priority: t.priority,
          required_role: t.required_role,
        })),
      };
    }

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/assignments/:id/generate-tasks/preview ────────────────────────


const generateTaskPreview = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const assignment = await Assignment.findById(id).populate("project_id");
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    const { assignmentType } = req.body;
    const supportedTypes = getSupportedTypes();

    if (!assignmentType || !supportedTypes.includes(assignmentType)) {
      return res.status(400).json({
        success: false,
        message: `assignmentType must be one of: ${supportedTypes.join(", ")}`,
      });
    }

    // Generate tasks sorted by priority
    const taskDrafts = generateTasksForAssignment(
      assignmentType,
      assignment.priority || "medium"
    );

    const totalHours = taskDrafts.reduce((s, t) => s + t.estimatedHours, 0);

    // Find candidate employees (for the admin to see who will be assigned)
    const allRoles = [...new Set(taskDrafts.map((t) => t.required_role).filter(Boolean))];
    const allDepts = [...new Set(taskDrafts.map((t) => t.required_department).filter(Boolean))];

    const candidateQuery = {
      status: "active",
      role: "employee",
      $or: [
        ...allRoles.map((r) => ({ designation: { $regex: r, $options: "i" } })),
        ...allDepts.map((d) => ({ department: { $regex: d, $options: "i" } })),
      ],
    };

    let candidates = await User.find(candidateQuery).select(
      "name email designation department dailyWorkingHours"
    );

    // Get active task count for each candidate (workload preview)
    const withLoad = await Promise.all(
      candidates.map(async (u) => {
        const activeCount = await Task.countDocuments({
          assigned_to: u._id,
          status: { $in: ["todo", "in-progress", "on-hold"] },
        });
        const totalActiveHours = await Task.aggregate([
          { $match: { assigned_to: u._id, status: { $in: ["todo", "in-progress", "on-hold"] } } },
          { $group: { _id: null, total: { $sum: "$estimated_hours" } } },
        ]);
        return {
          _id: u._id,
          name: u.name,
          designation: u.designation,
          department: u.department,
          dailyWorkingHours: u.dailyWorkingHours || DEFAULT_DAILY_HOURS,
          activeTaskCount: activeCount,
          activeTotalHours: totalActiveHours[0]?.total || 0,
        };
      })
    );

    return res.json({
      success: true,
      data: {
        assignment: {
          _id: assignment._id,
          title: assignment.title,
          type: assignmentType,
          priority: assignment.priority,
          start_date: assignment.start_date,
          end_date: assignment.end_date,
        },
        tasks: taskDrafts,
        summary: {
          taskCount: taskDrafts.length,
          totalEstimatedHours: totalHours,
          estimatedDays: Math.ceil(totalHours / DEFAULT_DAILY_HOURS),
          priorityBreakdown: {
            high: taskDrafts.filter((t) => t.priority === "high" || t.priority === "critical").length,
            medium: taskDrafts.filter((t) => t.priority === "medium").length,
            low: taskDrafts.filter((t) => t.priority === "low").length,
          },
        },
        candidateEmployees: withLoad,
      },
    });
  } catch (err) {
    console.error("[generateTaskPreview]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/assignments/:id/generate-tasks/confirm ────────────────────────


const confirmGenerateTasks = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const assignment = await Assignment.findById(id);
    if (!assignment)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    const project = await Project.findById(assignment.project_id);
    if (!project)
      return res.status(404).json({ success: false, message: "Project not found" });

    const { assignmentType, customTasks } = req.body;
    const supportedTypes = getSupportedTypes();

    if (!assignmentType || !supportedTypes.includes(assignmentType)) {
      return res.status(400).json({
        success: false,
        message: `assignmentType must be one of: ${supportedTypes.join(", ")}`,
      });
    }

    // Check for already-generated tasks (prevent duplicate generation)
    const existingCount = await Task.countDocuments({ assignment_id: assignment._id });
    if (existingCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Tasks already generated for this assignment (${existingCount} tasks exist). Delete them first to regenerate.`,
        existingCount,
      });
    }

    // Use custom tasks if admin modified them in the preview step, otherwise generate fresh
    let taskDrafts;
    if (customTasks && Array.isArray(customTasks) && customTasks.length > 0) {
      // Validate and normalize custom tasks
      taskDrafts = customTasks.map((t) => ({
        title: t.title || "Untitled Task",
        description: t.description || null,
        required_role: t.required_role || null,
        required_department: t.required_department || null,
        estimatedHours: Number(t.estimatedHours) || 4,
        priority: t.priority || "medium",
        status: "pending",
      }));
    } else {
      taskDrafts = generateTasksForAssignment(
        assignmentType,
        assignment.priority || "medium"
      );
    }

    // Smart assign: workload-balanced assignment with daily hour constraints
    const createdTasks = await smartAssignTasks(
      assignment,
      project,
      taskDrafts,
      req.user._id
    );

    // Update assignment's estimated_hours
    const totalHours = taskDrafts.reduce((s, t) => s + (t.estimatedHours || 0), 0);
    await Assignment.findByIdAndUpdate(assignment._id, {
      estimated_hours: totalHours,
    });

    // Notify admin
    await Notification.create({
      user_id: req.user._id,
      sender_id: null,
      message: `✅ ${createdTasks.length} tasks generated and smart-assigned for assignment "${assignment.title}" (${assignmentType}).`,
      type: "system_alert",
      ref_id: assignment._id,
      ref_type: "Assignment",
    }).catch(console.error);

    // Return with populated fields for immediate UI display
    const populated = await Task.find({
      _id: { $in: createdTasks.map((t) => t._id) },
    })
      .populate("assigned_to", "name email designation department")
      .sort({ priority_score: -1, start_date: 1 });

    return res.status(201).json({
      success: true,
      message: `${createdTasks.length} tasks generated and smart-assigned successfully`,
      data: {
        tasks: populated,
        summary: {
          totalTasks: createdTasks.length,
          totalEstimatedHours: totalHours,
          assignmentType,
        },
      },
    });
  } catch (err) {
    console.error("[confirmGenerateTasks]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/assignments/:id/workload ────────────────────────────────────────

/**
 * Returns workload distribution for employees assigned to tasks in this assignment.
 * Used by the admin dashboard workload chart.
 */
const getAssignmentWorkload = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const tasks = await Task.find({ assignment_id: id }).select("assigned_to estimated_hours status start_date end_date");

    if (!tasks.length) {
      return res.json({ success: true, data: [] });
    }

    const userIds = [...new Set(tasks.map((t) => t.assigned_to?.toString()).filter(Boolean))];
    const workload = await getWorkloadSummary(userIds);

    // Enrich with assignment-specific data
    const enriched = workload.map((w) => {
      const userTasks = tasks.filter(
        (t) => t.assigned_to?.toString() === w.user._id.toString()
      );
      return {
        ...w,
        assignmentTasks: userTasks.length,
        assignmentHours: userTasks.reduce((s, t) => s + (t.estimated_hours || 0), 0),
      };
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    console.error("[getAssignmentWorkload]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/assignments/:id/tasks ───────────────────────────────────────

/**
 * Delete all generated tasks for an assignment (to allow regeneration).
 */
const deleteAssignmentTasks = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid assignment ID" });

    const result = await Task.deleteMany({ assignment_id: id });

    return res.json({
      success: true,
      message: `${result.deletedCount} tasks deleted`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSupportedAssignmentTypes,
  generateTaskPreview,
  confirmGenerateTasks,
  getAssignmentWorkload,
  deleteAssignmentTasks,
};