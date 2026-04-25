/**
 * services/excelAssignmentService.js
 * ─────────────────────────────────────────────────────────
 * Smart assignment engine specifically for Excel task imports.
 * Builds on the existing autoAssignService pattern but is
 * self-contained so nothing existing is broken.
 *
 * PLACE AT: services/excelAssignmentService.js
 *
 * ALGORITHM:
 *  1. Find active employees matching required_role OR required_department
 *     (case-insensitive regex, same logic as adaptiveAssignmentEngine)
 *  2. Filter out employees on approved leave on the task start date
 *  3. Score each candidate: workload score + active task count
 *  4. Pick the lowest-score (least busy) employee
 *  5. If no match → task saved with assigned_to = null, status = 'unassigned'
 */

const User         = require('../models/users');
const Task         = require('../models/tasks');
const Leave        = require('../models/leave');

const PRIORITY_SCORE = { critical: 100, high: 75, medium: 50, low: 25 };

// ── in-request workload cache (avoid N+1 queries per import batch) ────────────
class WorkloadCache {
  constructor() { this._cache = new Map(); }

  async getScore(userId) {
    const key = userId.toString();
    if (this._cache.has(key)) return this._cache.get(key);

    const activeTasks = await Task.find({
      assigned_to: userId,
      status: { $in: ['todo', 'in-progress', 'on-hold'] },
    }).select('priority').lean();

    const score = activeTasks.reduce(
      (s, t) => s + (PRIORITY_SCORE[t.priority] || 0), 0
    );
    const data  = { score, count: activeTasks.length };
    this._cache.set(key, data);
    return data;
  }

  /** Increment cache after assignment (so next task sees updated load) */
  incrementScore(userId, priority) {
    const key = userId.toString();
    if (this._cache.has(key)) {
      const d = this._cache.get(key);
      d.score += PRIORITY_SCORE[priority] || 50;
      d.count += 1;
    }
  }
}

/**
 * Find all active employees matching role / department.
 * Returns mongoose lean objects: [{ _id, name, designation, department }]
 */
async function findCandidates(required_role, required_department) {
  const orConditions = [];

  if (required_role) {
    orConditions.push({
      designation: { $regex: required_role.trim(), $options: 'i' },
    });
  }
  if (required_department) {
    orConditions.push({
      department: { $regex: required_department.trim(), $options: 'i' },
    });
  }

  const query = {
    role:   'employee',
    status: 'active',
    ...(orConditions.length ? { $or: orConditions } : {}),
  };

  return User.find(query).select('_id name designation department').lean();
}

/**
 * Check if a user is on approved leave on a given date.
 */
async function isOnLeave(userId, date) {
  return Leave.exists({
    user_id:   userId,
    status:    'approved',
    from_date: { $lte: date },
    to_date:   { $gte: date },
  });
}

/**
 * Assign a single task row to the best available employee.
 *
 * @param {Object}        taskData      — validated, cleaned row
 * @param {Date}          startDate     — scheduled start date for this task
 * @param {WorkloadCache} workloadCache — shared across the batch
 * @returns {{ assigned_to: ObjectId|null, auto_assign_reason: string }}
 */
async function assignTask(taskData, startDate, workloadCache) {
  const candidates = await findCandidates(
    taskData.required_role,
    taskData.required_department
  );

  if (candidates.length === 0) {
    return {
      assigned_to:        null,
      is_auto_assigned:   false,
      auto_assign_reason: `No active employee found for role "${taskData.required_role}" / dept "${taskData.required_department}"`,
    };
  }

  // Filter out employees on leave
  const available = [];
  for (const c of candidates) {
    const onLeave = await isOnLeave(c._id, startDate);
    if (!onLeave) available.push(c);
  }

  if (available.length === 0) {
    return {
      assigned_to:        null,
      is_auto_assigned:   false,
      auto_assign_reason: `All matched employees are on leave for role "${taskData.required_role}"`,
    };
  }

  // Score + pick lowest workload
  const scored = await Promise.all(
    available.map(async (u) => {
      const wl = await workloadCache.getScore(u._id);
      return { user: u, score: wl.score, count: wl.count };
    })
  );

  scored.sort((a, b) => a.score - b.score || a.count - b.count);
  const best = scored[0];

  // Update in-memory cache so next task in the same batch sees this assignment
  workloadCache.incrementScore(best.user._id, taskData.priority || 'medium');

  return {
    assigned_to:        best.user._id,
    is_auto_assigned:   true,
    auto_assign_reason: `Auto-assigned to ${best.user.name} (${best.user.designation}) — workload score: ${best.score}`,
  };
}

/**
 * Assign all tasks in a batch, calculating sequential start dates.
 *
 * @param {Object[]} validRows      — from validateExcelRows().validRows
 * @param {Date}     projectStart   — project start date (used as base)
 * @param {string}   projectId      — MongoDB ObjectId string
 * @param {string}   assignedById   — the admin/manager who triggered the import
 * @returns {Object[]}  array of Task documents ready to be inserted
 */
async function assignBatch(validRows, projectStart, projectId, assignedById) {
  const cache     = new WorkloadCache();
  const prepared  = [];
  let   cursor    = new Date(projectStart);   // rolling start date

  // Add working days (skip weekends)
  function addWorkdays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++; // skip Sun(0) Sat(6)
    }
    return d;
  }

  for (const { data } of validRows) {
    const taskStartDate = new Date(cursor);
    const taskEndDate   = addWorkdays(taskStartDate, data.estimated_days || 1);

    const assignment    = await assignTask(data, taskStartDate, cache);
    const priorityScore = PRIORITY_SCORE[data.priority] || 50;

    prepared.push({
      project_id:         projectId,
      title:              data.title,
      description:        data.description,
      module_name:        data.module_name,
      subtask:            data.subtask,
      required_role:      data.required_role,
      required_department:data.required_department,
      priority:           data.priority || 'medium',
      priority_score:     priorityScore,
      estimated_days:     data.estimated_days || 1,
      estimated_hours:    data.estimated_hours || 8,
      start_date:         taskStartDate,
      end_date:           taskEndDate,
      due_date:           taskEndDate,
      status:             assignment.assigned_to ? 'todo' : 'unassigned',
      assigned_to:        assignment.assigned_to,
      assigned_by:        assignedById,
      is_auto_assigned:   assignment.is_auto_assigned,
      auto_assign_reason: assignment.auto_assign_reason,
      // dependency resolved separately after insert
      _dependencyRow:     data._dependencyRow || null,
    });

    // Advance cursor: next task starts when current one ends
    cursor = new Date(taskEndDate);
  }

  return prepared;
}

module.exports = { assignBatch, findCandidates, assignTask };