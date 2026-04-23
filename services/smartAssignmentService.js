/**
 * smartAssignmentService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Workload-balanced task assignment engine for assignment-type-based tasks.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CORE ALGORITHM — HOW SMART ASSIGNMENT WORKS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * STEP 1 — Sort tasks by priority (High → Medium → Low)
 *   Tasks are sorted so high-priority work is assigned first.
 *   High-priority tasks get earlier calendar slots.
 *
 * STEP 2 — For each task, find eligible employees
 *   Match by: required_role (designation) OR required_department.
 *   Only "active" employees are considered.
 *
 * STEP 3 — For each candidate, calculate daily workload
 *   We look at what tasks are already scheduled on each date.
 *   dailyLoad[userId][dateKey] = total hours already assigned on that day.
 *
 * STEP 4 — Find the first day where the employee has capacity
 *   Starting from project start_date (or today):
 *     remaining capacity = dailyWorkingHours - currentLoad[date]
 *     If estimatedHours ≤ remaining capacity → assign on that day
 *     Else → try next working day (skip weekends)
 *     If task spans multiple days → split across consecutive days
 *
 * STEP 5 — Assign: pick the employee with the EARLIEST available slot
 *   "Least loaded" = can start work soonest.
 *   If tied on start date → pick employee with least total active tasks.
 *
 * STEP 6 — Record assignment
 *   Store: assignedDate, expectedCompletionDate, estimatedHours
 *   Update the in-memory dailyLoad map to reflect new assignment.
 *
 * DAILY CAPACITY CONSTRAINT:
 *   - Each employee has dailyWorkingHours (default: 8, from User model)
 *   - A task that takes 10 hours spans 2 days: day1 uses 8hrs, day2 uses 2hrs
 *   - No day can exceed the employee's dailyWorkingHours
 *
 * PRIORITY-BASED SCHEDULING:
 *   - High priority tasks are processed first → get earliest dates
 *   - If workload is full on day D, lower-priority tasks are pushed to day D+1, D+2...
 *   - This prevents low-priority work from blocking high-priority assignments
 * ════════════════════════════════════════════════════════════════════════════
 */

const Task = require("../models/tasks");
const User = require("../models/users");
const Leave = require("../models/leave");
const Notification = require("../models/notification");

const DEFAULT_DAILY_HOURS = 8;

// ─── Date Helpers ────────────────────────────────────────────────────────────

/**
 * Format a Date as "YYYY-MM-DD" string key for the dailyLoad map.
 */
function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Advance date by N calendar days (mutates a copy).
 */
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Move forward to the next working day if on weekend.
 */
function nextWorkDay(date) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Get the next working day AFTER a given date.
 */
function nextWorkDayAfter(date) {
  const d = addDays(date, 1);
  return nextWorkDay(d);
}

// ─── Load existing task schedule for employees ───────────────────────────────

/**
 * Build a daily load map for a set of user IDs.
 * Returns: { userId: { "2025-01-15": 6.5, "2025-01-16": 3, ... }, ... }
 *
 * This is used to know how many hours are already booked per day per employee.
 * We look at tasks that are: todo, in-progress, or on-hold (active work).
 *
 * @param {string[]} userIds
 * @returns {Object} dailyLoad map
 */
async function buildDailyLoadMap(userIds) {
  const activeTasks = await Task.find({
    assigned_to: { $in: userIds },
    status: { $in: ["todo", "in-progress", "on-hold", "pending"] },
    start_date: { $ne: null },
  }).select("assigned_to start_date end_date estimated_hours");

  const loadMap = {};
  for (const userId of userIds) {
    loadMap[userId.toString()] = {};
  }

  for (const task of activeTasks) {
    const uid = task.assigned_to.toString();
    if (!loadMap[uid]) continue;

    const hours = task.estimated_hours || DEFAULT_DAILY_HOURS;
    let cursor = nextWorkDay(new Date(task.start_date));
    const end = task.end_date ? new Date(task.end_date) : cursor;
    let remaining = hours;

    // Distribute task hours across its working days
    while (remaining > 0 && cursor <= end) {
      const key = dateKey(cursor);
      loadMap[uid][key] = (loadMap[uid][key] || 0) + Math.min(remaining, DEFAULT_DAILY_HOURS);
      remaining -= DEFAULT_DAILY_HOURS;
      cursor = nextWorkDayAfter(cursor);
    }
  }

  return loadMap;
}

/**
 * Check if a user is on approved leave on a specific date.
 */
async function isOnLeave(userId, date) {
  const leave = await Leave.findOne({
    user_id: userId,
    status: "approved",
    from_date: { $lte: date },
    to_date: { $gte: date },
  });
  return !!leave;
}

// ─── Core scheduling logic for a single task ─────────────────────────────────

/**
 * Find the earliest date(s) where an employee can fit a task,
 * respecting the daily working hours constraint.
 *
 * ALGORITHM:
 *  - Start from `fromDate` (project start or today)
 *  - Check each working day: how many hours already booked?
 *  - accumulate available hours until we've covered estimatedHours
 *  - Return: { assignedDate, expectedCompletionDate, dailySplit }
 *    dailySplit = [{ date, hours }] showing how hours are spread across days
 *
 * @param {Object}  loadMap       - { "YYYY-MM-DD": hoursBooked }  for THIS user
 * @param {Date}    fromDate      - Earliest possible start date
 * @param {number}  estimatedHours
 * @param {number}  dailyCapacity - User's max working hours per day
 * @returns {{ assignedDate: Date, expectedCompletionDate: Date, dailySplit: [] }}
 */
function findSlotForTask(loadMap, fromDate, estimatedHours, dailyCapacity) {
  let cursor = nextWorkDay(new Date(fromDate));
  let remaining = estimatedHours;
  let assignedDate = null;
  const dailySplit = [];

  // Safety: don't loop more than 60 working days
  let attempts = 0;
  while (remaining > 0 && attempts < 60) {
    attempts++;
    const key = dateKey(cursor);
    const alreadyBooked = loadMap[key] || 0;
    const available = dailyCapacity - alreadyBooked;

    if (available > 0) {
      const hoursThisDay = Math.min(available, remaining);
      if (!assignedDate) assignedDate = new Date(cursor);

      dailySplit.push({ date: new Date(cursor), hours: hoursThisDay });
      remaining -= hoursThisDay;
    }

    if (remaining > 0) {
      cursor = nextWorkDayAfter(cursor);
    }
  }

  const expectedCompletionDate =
    dailySplit.length > 0
      ? dailySplit[dailySplit.length - 1].date
      : assignedDate;

  return {
    assignedDate: assignedDate || nextWorkDay(new Date(fromDate)),
    expectedCompletionDate: expectedCompletionDate || nextWorkDay(new Date(fromDate)),
    dailySplit,
  };
}

/**
 * Update the in-memory load map after assigning a task.
 * This must be called immediately after picking a slot so the NEXT
 * task assignment in the same batch sees updated load data.
 */
function applyLoadToMap(loadMap, dailySplit) {
  for (const slot of dailySplit) {
    const key = dateKey(slot.date);
    loadMap[key] = (loadMap[key] || 0) + slot.hours;
  }
}

// ─── Main Smart Assignment Function ──────────────────────────────────────────

/**
 * Assign tasks from a generated task list to employees using smart workload balancing.
 *
 * ════════════════════════════════════════════════════
 * HIGH-LEVEL FLOW:
 *
 *  1. Sort all task drafts by priority (High first)
 *  2. Build dailyLoad map for ALL candidate employees
 *  3. For each task (in priority order):
 *     a. Find employees matching required_role / required_department
 *     b. For each candidate, find their earliest available slot
 *     c. Pick the candidate with the EARLIEST slot (= "least loaded")
 *     d. Save task to DB with assignedDate + expectedCompletionDate
 *     e. Update in-memory load map immediately
 * ════════════════════════════════════════════════════
 *
 * @param {Object}   assignment     - Mongoose Assignment document
 * @param {Object}   project        - Mongoose Project document
 * @param {Object[]} taskDrafts     - Output from generateTasksForAssignment()
 * @param {string}   assignedById   - Admin/Manager user ID
 * @returns {Object[]} Created Task documents
 */
async function smartAssignTasks(assignment, project, taskDrafts, assignedById) {
  // ── STEP 1: Sort by priority (critical → high → medium → low) ──────────
  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...taskDrafts].sort(
    (a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );

  // ── STEP 2: Collect all candidate user IDs up front ────────────────────
  const allRoles = [...new Set(sorted.map((t) => t.required_role).filter(Boolean))];
  const allDepts = [...new Set(sorted.map((t) => t.required_department).filter(Boolean))];

  const candidateQuery = {
    status: "active",
    role: "employee",
    $or: [
      ...allRoles.map((r) => ({ designation: { $regex: r, $options: "i" } })),
      ...allDepts.map((d) => ({ department: { $regex: d, $options: "i" } })),
    ],
  };
  if (allRoles.length === 0 && allDepts.length === 0) {
    candidateQuery.$or = [{ role: "employee" }];
  }

  const allCandidates = await User.find(candidateQuery).select(
    "name email designation department dailyWorkingHours status"
  );

  if (!allCandidates.length) {
    throw new Error(
      "No eligible employees found for this assignment. Please add employees with matching roles/departments."
    );
  }

  // ── STEP 3: Build daily load map (in memory — updated as we assign) ────
  const candidateIds = allCandidates.map((u) => u._id);
  const globalLoadMap = await buildDailyLoadMap(candidateIds);
  // Per-user local maps (we mutate these as tasks are assigned in this batch)
  const userLoadMaps = {};
  for (const u of allCandidates) {
    userLoadMaps[u._id.toString()] = { ...(globalLoadMap[u._id.toString()] || {}) };
  }

  const startFrom = project.start_date ? new Date(project.start_date) : new Date();
  const createdTasks = [];

  // ── STEP 4: Assign each task ────────────────────────────────────────────
  for (const draft of sorted) {
    // Find matching employees for this task's role/dept
    let pool = allCandidates.filter((u) => {
      const roleMatch = draft.required_role
        ? u.designation?.toLowerCase().includes(draft.required_role.toLowerCase())
        : false;
      const deptMatch = draft.required_department
        ? u.department?.toLowerCase().includes(draft.required_department.toLowerCase())
        : false;
      return roleMatch || deptMatch;
    });

    // Fallback: any active employee
    if (!pool.length) pool = allCandidates;

    // ── STEP 5: For each candidate find earliest slot ─────────────────────
    const slots = await Promise.all(
      pool.map(async (user) => {
        const uid = user._id.toString();
        const capacity = user.dailyWorkingHours || DEFAULT_DAILY_HOURS;
        const onLeave = await isOnLeave(user._id, startFrom);

        const slot = findSlotForTask(
          userLoadMaps[uid] || {},
          startFrom,
          draft.estimatedHours,
          capacity
        );

        return {
          user,
          capacity,
          onLeave,
          ...slot,
          // Count active tasks as secondary sort key
          activeTaskCount: Object.values(userLoadMaps[uid] || {}).filter((h) => h > 0).length,
        };
      })
    );

    // ── STEP 6: Pick best candidate ────────────────────────────────────────
    // Sort: not-on-leave first, then earliest assignedDate, then fewest active days
    slots.sort((a, b) => {
      if (a.onLeave !== b.onLeave) return a.onLeave ? 1 : -1;
      const dateDiff = new Date(a.assignedDate) - new Date(b.assignedDate);
      if (dateDiff !== 0) return dateDiff;
      return a.activeTaskCount - b.activeTaskCount;
    });

    const best = slots[0];
    if (!best) continue;

    const assignee = best.user;
    const uid = assignee._id.toString();

    // ── STEP 7: Save task to database ──────────────────────────────────────
    const task = await Task.create({
      project_id: project._id,
      assignment_id: assignment._id,
      title: draft.title,
      description: draft.description || null,
      assigned_to: assignee._id,
      assigned_by: assignedById,
      status: "todo",
      priority: draft.priority || "medium",
      priority_score:
        { critical: 100, high: 75, medium: 50, low: 25 }[draft.priority] || 50,
      // ── Scheduling fields ────────────────────────────────────────────
      start_date: best.assignedDate,          // first day work starts
      end_date: best.expectedCompletionDate,   // last day work ends
      due_date: assignment.end_date || best.expectedCompletionDate,
      estimated_days: Math.ceil(draft.estimatedHours / (assignee.dailyWorkingHours || DEFAULT_DAILY_HOURS)),
      estimated_hours: draft.estimatedHours,
      is_auto_assigned: true,
      auto_assign_reason: `Smart assigned: ${assignee.name} had earliest available slot (${best.assignedDate.toDateString()})`,
      required_role: draft.required_role || null,
      required_department: draft.required_department || null,
    });

    createdTasks.push(task);

    // ── STEP 8: Update in-memory load map so next task sees updated load ──
    applyLoadToMap(userLoadMaps[uid], best.dailySplit);

    // ── STEP 9: Notify employee ───────────────────────────────────────────
    await Notification.create({
      user_id: assignee._id,
      sender_id: assignedById,
      message: `[Auto-Assigned] Task "${task.title}" scheduled for ${best.assignedDate.toDateString()} – ${best.expectedCompletionDate.toDateString()}. Estimated: ${draft.estimatedHours} hrs.`,
      type: "auto_assign",
      ref_id: task._id,
      ref_type: "Task",
    }).catch(console.error);

    // Warn admin if employee is on leave
    if (best.onLeave) {
      await Notification.create({
        user_id: assignedById,
        sender_id: null,
        message: `⚠️ "${assignee.name}" was assigned task "${task.title}" but may be on leave on ${best.assignedDate.toDateString()}.`,
        type: "leave_cover_assigned",
        ref_id: task._id,
        ref_type: "Task",
      }).catch(console.error);
    }
  }

  return createdTasks;
}

/**
 * Calculate current workload summary for a set of employees.
 * Used by the admin dashboard to show workload distribution.
 *
 * @param {string[]} userIds
 * @returns {Object[]} Array of { user, totalHours, taskCount, dailyLoad }
 */
async function getWorkloadSummary(userIds) {
  const users = await User.find({ _id: { $in: userIds } }).select(
    "name email designation department dailyWorkingHours"
  );

  const loadMap = await buildDailyLoadMap(userIds);

  return users.map((user) => {
    const uid = user._id.toString();
    const daily = loadMap[uid] || {};
    const totalHours = Object.values(daily).reduce((s, h) => s + h, 0);
    const activeDays = Object.keys(daily).filter((d) => daily[d] > 0).length;

    return {
      user: { _id: user._id, name: user.name, designation: user.designation },
      dailyWorkingHours: user.dailyWorkingHours || DEFAULT_DAILY_HOURS,
      totalHours,
      activeDays,
      dailyLoad: daily,
    };
  });
}

module.exports = {
  smartAssignTasks,
  getWorkloadSummary,
  buildDailyLoadMap,
  findSlotForTask,
  DEFAULT_DAILY_HOURS,
};