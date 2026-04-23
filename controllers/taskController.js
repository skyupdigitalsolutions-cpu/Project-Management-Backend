/**
 * controllers/taskController.js
 * Added: requestPermission — employee-initiated permission request on a blocked/pending task
 * Everything else unchanged from original.
 */

const Task         = require('../models/tasks');
const Notification = require('../models/notification');
const mongoose     = require('mongoose');
const eventBus     = require('../services/eventBus');
const {
  rebalanceTasks,
  getUserWorkloadScore,
} = require('../services/autoAssignService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || 'Internal server error' });
};

const PRIORITY_SCORE = { critical: 100, high: 75, medium: 50, low: 25 };

// ─── CREATE ──────────────────────────────────────────────────────────────────

const createTask = async (req, res) => {
  try {
    const {
      project_id, assignment_id, title, description, assigned_to, assigned_by,
      status, priority, due_date, estimated_hours,
      requires_permission, permission_description,
      required_role, required_department,
    } = req.body;

    if (!isValidObjectId(project_id))
      return res.status(400).json({ success: false, message: 'Invalid project_id' });
    if (assigned_to && !isValidObjectId(assigned_to))
      return res.status(400).json({ success: false, message: 'Invalid assigned_to' });

    const permStatus      = requires_permission ? 'pending' : 'not_required';
    const effectiveStatus = requires_permission ? 'blocked' : (status || 'todo');
    const priorityScore   = PRIORITY_SCORE[priority || 'medium'] || 50;

    const task = await Task.create({
      project_id, title, description, assigned_to: assigned_to || null,
      assignment_id: assignment_id || null,
      assigned_by:            assigned_by || req.user?._id,
      status:                 effectiveStatus,
      priority:               priority || 'medium',
      priority_score:         priorityScore,
      due_date,
      estimated_hours,
      requires_permission:    !!requires_permission,
      permission_description: permission_description || null,
      permission_status:      permStatus,
      required_role:          required_role || null,
      required_department:    required_department || null,
    });

    if (assigned_to && assigned_to.toString() !== req.user?._id?.toString()) {
      await Notification.create({
        user_id:   assigned_to,
        sender_id: req.user?._id ?? null,
        message:   `You have been assigned a new task: "${title}"`,
        type:      'task_assigned',
        ref_id:    task._id,
        ref_type:  'Task',
      }).catch(console.error);
    }

    if (requires_permission) {
      await Notification.create({
        user_id:   req.user?._id,
        sender_id: null,
        message:   `🔐 Task "${title}" requires admin permission. Status: Pending.`,
        type:      'permission_requested',
        ref_id:    task._id,
        ref_type:  'Task',
      }).catch(console.error);
    }

    eventBus.emitAsync('task:created', {
      task,
      adminId: req.user?._id,
    }).catch((err) => console.error('[EVENT] task:created handler error:', err.message));

    return res.status(201).json({ success: true, data: task });
  } catch (error) {
    if (error.name === 'ValidationError')
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── READ ALL ────────────────────────────────────────────────────────────────

const getAllTasks = async (req, res) => {
  try {
    const {
      project_id, assigned_to, status, priority,
      is_delayed, requires_permission, permission_status,
      page = 1, limit = 20,
    } = req.query;

    const filter = {};
    if (project_id)   { if (!isValidObjectId(project_id)) return res.status(400).json({ success: false, message: 'Invalid project_id' }); filter.project_id = project_id; }
    if (assigned_to)  { if (!isValidObjectId(assigned_to)) return res.status(400).json({ success: false, message: 'Invalid assigned_to' }); filter.assigned_to = assigned_to; }
    if (status)       filter.status = status;
    if (priority)     filter.priority = priority;
    if (is_delayed !== undefined) filter.is_delayed = is_delayed === 'true';
    if (requires_permission !== undefined) filter.requires_permission = requires_permission === 'true';
    if (permission_status)  filter.permission_status = permission_status;

    const skip = (Number(page) - 1) * Number(limit);
    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('project_id',          'title priority status')
        .populate('assigned_to',          'name email department designation')
        .populate('assigned_by',          'name email')
        .populate('permission_granted_by','name email')
        .sort({ priority_score: -1, due_date: 1 })
        .skip(skip)
        .limit(Number(limit)),
      Task.countDocuments(filter),
    ]);

    const today = new Date();
    for (const task of tasks) {
      if (task.due_date < today && task.status !== 'completed' && task.status !== 'cancelled' && !task.is_delayed) {
        await Task.findByIdAndUpdate(task._id, { is_delayed: true });
        task.is_delayed = true;
      }
    }

    return res.status(200).json({
      success: true, total,
      page:    Number(page),
      pages:   Math.ceil(total / Number(limit)),
      data:    tasks,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── READ ONE ────────────────────────────────────────────────────────────────

const getTaskById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const task = await Task.findById(id)
      .populate('project_id',           'title priority status project_type')
      .populate('assigned_to',           'name email department designation status')
      .populate('assigned_by',           'name email')
      .populate('permission_granted_by', 'name email')
      .populate('delay_logs.reported_by','name email')
      .populate('reassign_logs.from_user','name email')
      .populate('reassign_logs.to_user',  'name email')
      .populate('reassign_logs.reassigned_by','name email');

    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────

const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const existing = await Task.findById(id).select('priority assigned_to due_date').lean();
    if (!existing)
      return res.status(404).json({ success: false, message: 'Task not found' });

    const before = {
      priority:    existing.priority,
      assigned_to: existing.assigned_to?.toString() || null,
      due_date:    existing.due_date,
    };

    const updates = { ...req.body };
    delete updates._id; delete updates.createdAt; delete updates.updatedAt;
    delete updates.delay_logs; delete updates.reassign_logs;

    if (updates.status === 'completed') {
      updates.completed_at    = updates.completed_at ?? new Date();
      updates.progress_percent = 100;
    } else if (updates.status && updates.status !== 'completed') {
      updates.completed_at = null;
    }

    if (updates.priority) {
      updates.priority_score = PRIORITY_SCORE[updates.priority] || 50;
    }

    const task = await Task.findByIdAndUpdate(
      id, { $set: updates }, { new: true, runValidators: true }
    )
      .populate('project_id',  'title priority status')
      .populate('assigned_to', 'name email department designation')
      .populate('assigned_by', 'name email');

    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    const after = {
      priority:    updates.priority    ?? before.priority,
      assigned_to: updates.assigned_to !== undefined
        ? (updates.assigned_to ? updates.assigned_to.toString() : null)
        : before.assigned_to,
      due_date:    updates.due_date    ?? before.due_date,
    };

    eventBus.emitAsync('task:updated', {
      taskId:  id,
      before,
      after,
      adminId: req.user?._id,
    }).catch((err) => console.error('[EVENT] task:updated handler error:', err.message));

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    if (error.name === 'ValidationError')
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────

const deleteTask = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });
    const task = await Task.findByIdAndDelete(id);
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });
    return res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── BULK STATUS UPDATE ──────────────────────────────────────────────────────

const bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
    if (!ids.every(isValidObjectId))
      return res.status(400).json({ success: false, message: 'One or more invalid task IDs' });

    const validStatuses = ['todo', 'in-progress', 'completed', 'on-hold', 'cancelled', 'blocked'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}` });

    const setFields = { status };
    if (status === 'completed') { setFields.completed_at = new Date(); setFields.progress_percent = 100; }
    else setFields.completed_at = null;

    const result = await Task.updateMany({ _id: { $in: ids } }, { $set: setFields }, { runValidators: true });
    return res.status(200).json({ success: true, message: `${result.modifiedCount} task(s) updated` });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── LOG DELAY ───────────────────────────────────────────────────────────────

const logDelay = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const { reason, new_due_date } = req.body;
    if (!reason || reason.trim().length < 10)
      return res.status(400).json({ success: false, message: 'Delay reason must be at least 10 characters' });

    const task = await Task.findById(id);
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    task.delay_logs.push({
      reason:            reason.trim(),
      reported_by:       req.user?._id || null,
      reported_at:       new Date(),
      previous_due_date: task.due_date,
      new_due_date:      new_due_date ? new Date(new_due_date) : null,
    });
    task.is_delayed   = true;
    task.delay_reason = reason.trim();
    if (new_due_date) task.due_date = new Date(new_due_date);
    await task.save();

    if (task.assigned_by) {
      await Notification.create({
        user_id:   task.assigned_by,
        sender_id: req.user?._id || null,
        message:   `⚠️ Task "${task.title}" delayed. Reason: ${reason.substring(0, 80)}`,
        type:      'task_delayed',
        ref_id:    task._id,
        ref_type:  'Task',
      }).catch(console.error);
    }

    return res.status(200).json({ success: true, message: 'Delay logged', data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE PROGRESS ─────────────────────────────────────────────────────────

const updateProgress = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const { progress_percent, actual_hours } = req.body;
    if (progress_percent === undefined || progress_percent < 0 || progress_percent > 100)
      return res.status(400).json({ success: false, message: 'progress_percent must be 0–100' });

    const updates = { progress_percent };
    if (actual_hours !== undefined) updates.actual_hours = actual_hours;
    if (progress_percent === 100) { updates.status = 'completed'; updates.completed_at = new Date(); }

    const task = await Task.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
      .populate('assigned_to', 'name email');
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    if (progress_percent === 100 && task.assigned_by) {
      await Notification.create({
        user_id:   task.assigned_by,
        sender_id: req.user?._id || null,
        message:   `✅ Task "${task.title}" completed by ${task.assigned_to?.name}.`,
        type:      'task_completed',
        ref_id:    task._id,
        ref_type:  'Task',
      }).catch(console.error);
    }

    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── HANDLE PERMISSION (Admin: grant / deny) ──────────────────────────────────

const handlePermission = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const { action } = req.body;
    if (!['grant', 'deny'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be "grant" or "deny"' });

    const task = await Task.findById(id);
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });
    if (task.permission_status === 'granted')
      return res.status(400).json({ success: false, message: 'Permission already granted' });

    const isGrant = action === 'grant';
    task.permission_status     = isGrant ? 'granted' : 'denied';
    task.permission_granted_by = req.user._id;
    task.permission_granted_at = new Date();
    if (isGrant && task.status === 'blocked') task.status = 'todo';
    await task.save();

    await Notification.create({
      user_id:   task.assigned_to,
      sender_id: req.user._id,
      message:   isGrant
        ? `✅ Permission granted for task "${task.title}". You can now start working on it.`
        : `❌ Permission denied for task "${task.title}". Please contact your manager for more info.`,
      type:    isGrant ? 'permission_granted' : 'permission_denied',
      ref_id:  task._id,
      ref_type:'Task',
    }).catch(console.error);

    return res.status(200).json({ success: true, message: `Permission ${action}ed`, data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── REQUEST PERMISSION (Employee → Admin) ────────────────────────────────────
// POST /api/tasks/:id/request-permission
// Body: { reason }  — employee explains why they need access / what they're requesting

const requestPermission = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const { reason } = req.body;
    if (!reason || reason.trim().length < 5)
      return res.status(400).json({ success: false, message: 'Please provide a reason (min 5 characters)' });

    const task = await Task.findById(id).populate('assigned_to', 'name');
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    // Allow: the assigned employee, OR any employee sending a general update/message
    // (task.assigned_to may be null for unassigned tasks, or the employee sending a message
    //  about a task they have context on — we check they're at least an employee role)
    const assignedUserId = task.assigned_to?._id?.toString() ?? task.assigned_to?.toString();
    const requestingUserId = req.user._id.toString();
    const isAssigned = assignedUserId === requestingUserId;
    const isEmployee = req.user.role === 'employee';

    if (!isAssigned && !isEmployee) {
      return res.status(403).json({ success: false, message: 'You are not authorised to request permission for this task' });
    }

    // If the task already has permission granted, allow re-requesting (sends update to admin)
    // Only block if permission is already granted AND the employee is sending a duplicate request
    if (task.permission_status === 'granted' && isAssigned) {
      // Allow anyway — employee might want to send a follow-up message
      // (we won't change the status back to pending in this case)
    }

    // Collect attachment metadata if files were uploaded
    const attachments = (req.files || []).map(f => f.originalname);
    const attachmentNote = attachments.length > 0 ? ` [Attached: ${attachments.join(', ')}]` : '';

    // Only update task permission fields if the caller is the assigned employee
    if (isAssigned && task.permission_status !== 'granted') {
      task.permission_status      = 'pending';
      task.requires_permission    = true;
      task.permission_description = reason.trim() + attachmentNote;
      await task.save();
    }

    // Notify ALL admins and managers via in-app notification
    const User = require('../models/users');
    const recipients = await User.find({ role: { $in: ['admin', 'manager'] }, status: 'active' }).select('_id');

    const notifDocs = recipients.map(u => ({
      user_id:   u._id,
      sender_id: req.user._id,
      message:   `🔐 Approval request from ${req.user.name} for task "${task.title}": ${reason.trim().substring(0, 120)}${attachments.length ? " 📎 " + attachments.length + " file(s)" : ""}`,
      type:      'permission_requested',
      ref_id:    task._id,
      ref_type:  'Task',
    }));

    if (notifDocs.length > 0) {
      await Notification.insertMany(notifDocs).catch(console.error);
    }

    return res.status(200).json({
      success: true,
      message: 'Approval request sent. You will be notified once reviewed.',
      data: task,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── MANUAL REASSIGN ─────────────────────────────────────────────────────────

const reassignTask = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid task ID' });

    const { new_assignee_id, reason } = req.body;
    if (!isValidObjectId(new_assignee_id))
      return res.status(400).json({ success: false, message: 'Invalid new_assignee_id' });

    const task = await Task.findById(id);
    if (!task)
      return res.status(404).json({ success: false, message: 'Task not found' });

    const previousAssignee = task.assigned_to;
    task.reassign_logs.push({
      from_user:     previousAssignee,
      to_user:       new_assignee_id,
      reason:        reason || 'Manual reassignment',
      reassigned_by: req.user._id,
      trigger:       'manual',
    });
    task.assigned_to = new_assignee_id;
    await task.save();

    await Notification.create({
      user_id:   new_assignee_id,
      sender_id: req.user._id,
      message:   `📋 Task "${task.title}" reassigned to you. Reason: ${reason || 'Not specified'}`,
      type:      'task_reassigned',
      ref_id:    task._id,
      ref_type:  'Task',
    }).catch(console.error);

    return res.status(200).json({ success: true, message: 'Task reassigned', data: task });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── STATS ───────────────────────────────────────────────────────────────────

const getTaskStats = async (req, res) => {
  try {
    const { project_id, assigned_to } = req.query;
    const match = {};
    if (project_id) { if (!isValidObjectId(project_id)) return res.status(400).json({ success: false, message: 'Invalid project_id' }); match.project_id = new mongoose.Types.ObjectId(project_id); }
    if (assigned_to) { if (!isValidObjectId(assigned_to)) return res.status(400).json({ success: false, message: 'Invalid assigned_to' }); match.assigned_to = new mongoose.Types.ObjectId(assigned_to); }
    // Employees automatically see only their own task stats
    if (req.user.role === 'employee') { match.assigned_to = req.user._id; }

    const [statusStats, delayStats, permissionStats] = await Promise.all([
      Task.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Task.aggregate([{ $match: { ...match, is_delayed: true } }, { $count: 'delayed_count' }]),
      Task.aggregate([{ $match: { ...match, requires_permission: true } }, { $group: { _id: '$permission_status', count: { $sum: 1 } } }]),
    ]);

    const summary     = statusStats.reduce((acc, { _id, count }) => { acc[_id] = count; return acc; }, {});
    const permSummary = permissionStats.reduce((acc, { _id, count }) => { acc[_id] = count; return acc; }, {});

    return res.status(200).json({
      success: true,
      data: { by_status: summary, delayed_count: delayStats[0]?.delayed_count || 0, permissions: permSummary },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── WORKLOAD OVERVIEW ────────────────────────────────────────────────────────

const getWorkloadOverview = async (req, res) => {
  try {
    const { project_id } = req.query;
    const match = { status: { $in: ['todo', 'in-progress', 'on-hold'] } };
    if (project_id) {
      if (!isValidObjectId(project_id)) return res.status(400).json({ success: false, message: 'Invalid project_id' });
      match.project_id = new mongoose.Types.ObjectId(project_id);
    }

    const grouped = await Task.aggregate([
      { $match: match },
      { $group: { _id: '$assigned_to', task_count: { $sum: 1 }, priorities: { $push: '$priority' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', email: '$user.email', designation: '$user.designation', department: '$user.department', task_count: 1, priorities: 1 } },
    ]);

    const result = grouped.map((g) => {
      const score = g.priorities.reduce((s, p) => s + ({ critical: 100, high: 75, medium: 50, low: 25 }[p] || 0), 0);
      return { ...g, workload_score: score };
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createTask, getAllTasks, getTaskById, updateTask, deleteTask,
  bulkUpdateStatus, logDelay, updateProgress, handlePermission,
  requestPermission,
  reassignTask, getTaskStats, getWorkloadOverview,
};