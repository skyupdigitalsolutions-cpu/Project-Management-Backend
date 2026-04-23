/**
 * services/workflowHandlers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers all event listeners on the application event bus.
 *
 * This file is the single place that connects events → assignment logic.
 * Controllers emit events; this file handles them.
 *
 * IMPORTED ONCE in server.js after DB connects:
 *   require('./services/workflowHandlers');
 *
 * EVENTS HANDLED:
 *   project:created   → run autoAssignProjectTasks
 *   task:created      → check if any user is now overloaded; trigger rebalance
 *   task:updated      → run autoReassignOnTaskUpdate for meaningful changes
 *   leave:approved    → run handleLeaveReassignment
 *   workload:exceeded → run rebalanceTasks
 */

const eventBus = require('./eventBus');
const {
  autoAssignProjectTasks,
  autoReassignOnTaskUpdate,
  handleLeaveReassignment,
  rebalanceTasks,
  getUserWorkloadScore,
  MAX_WORKLOAD_SCORE,
} = require('./autoAssignService');
const log = require('./assignmentLogger');

// ─── project:created ─────────────────────────────────────────────────────────

/**
 * Triggered after a project is saved and task drafts are available.
 *
 * Payload: { project, taskDrafts, adminId }
 *
 * taskDrafts are the raw task objects from documentParser or manual entry.
 * Each draft needs at minimum: { title, required_role, priority, estimated_days }.
 */
eventBus.on('project:created', async ({ project, taskDrafts, adminId }) => {
  if (!taskDrafts || taskDrafts.length === 0) {
    log.info('project:created — no task drafts, skipping auto-assign', {
      projectId: project._id?.toString(),
    });
    return;
  }

  log.info('project:created — triggering autoAssignProjectTasks', {
    projectId:  project._id?.toString(),
    draftCount: taskDrafts.length,
  });

  try {
    const assigned = await autoAssignProjectTasks(project, taskDrafts, adminId);
    log.info('project:created — assignment complete', {
      projectId: project._id?.toString(),
      assigned:  assigned.length,
    });
  } catch (err) {
    log.error({ taskId: null, taskTitle: 'batch', err });
  }
});

// ─── task:created ─────────────────────────────────────────────────────────────

/**
 * Triggered after a single new task is manually created (not auto-assigned).
 *
 * Payload: { task, adminId }
 *
 * If the assigned user is now over the workload threshold, trigger a rebalance
 * scoped to their project. High-priority tasks are more likely to push over.
 */
eventBus.on('task:created', async ({ task, adminId }) => {
  if (!task.assigned_to) return;

  try {
    const score = await getUserWorkloadScore(task.assigned_to);

    // Only rebalance for high/critical tasks or if score is significantly over threshold
    const shouldRebalance =
      score > MAX_WORKLOAD_SCORE &&
      (task.priority === 'high' || task.priority === 'critical' || score > MAX_WORKLOAD_SCORE * 1.5);

    if (shouldRebalance) {
      log.info('task:created — rebalance triggered', {
        userId:    task.assigned_to?.toString(),
        score,
        taskTitle: task.title,
      });
      await rebalanceTasks(task.project_id, MAX_WORKLOAD_SCORE, adminId);
    }
  } catch (err) {
    log.error({ taskId: task._id, taskTitle: task.title, err });
  }
});

// ─── task:updated ─────────────────────────────────────────────────────────────

/**
 * Triggered after a task is updated via PATCH /tasks/:id.
 *
 * Payload: { taskId, before, after, adminId }
 *   before = { priority, assigned_to, due_date }  (snapshot before update)
 *   after  = { priority, assigned_to, due_date }  (values from req.body)
 *
 * Only triggers reassignment for MEANINGFUL changes:
 *   - priority escalated
 *   - assigned_to cleared
 * Ignores: description changes, progress updates, status toggles, etc.
 */
eventBus.on('task:updated', async ({ taskId, before, after, adminId }) => {
  const priorityChanged  = after.priority && before.priority !== after.priority;
  const assigneeCleared  = before.assigned_to && after.assigned_to === null;

  if (!priorityChanged && !assigneeCleared) return;

  log.info('task:updated — meaningful change detected, checking reassignment', {
    taskId: taskId?.toString(),
    priorityChanged,
    assigneeCleared,
  });

  try {
    await autoReassignOnTaskUpdate(taskId, before, after, adminId);
  } catch (err) {
    log.error({ taskId, taskTitle: 'unknown', err });
  }
});

// ─── leave:approved ───────────────────────────────────────────────────────────

/**
 * Triggered when an admin approves a leave request.
 *
 * Payload: { leave, adminId }
 *   leave = { user_id, from_date, to_date, ... }
 */
eventBus.on('leave:approved', async ({ leave, adminId }) => {
  log.info('leave:approved — triggering handleLeaveReassignment', {
    userId:    leave.user_id?.toString(),
    leaveFrom: leave.from_date,
    leaveTo:   leave.to_date,
  });

  try {
    const reassigned = await handleLeaveReassignment(
      leave.user_id,
      new Date(leave.from_date),
      new Date(leave.to_date),
      adminId
    );
    log.info('leave:approved — reassignment complete', { reassigned: reassigned.length });
  } catch (err) {
    log.error({ taskId: null, taskTitle: 'leave reassign batch', err });
  }
});

// ─── workload:exceeded ────────────────────────────────────────────────────────

/**
 * Triggered explicitly when a component detects an overload condition
 * (e.g. SmartAssignmentService or a periodic check).
 *
 * Payload: { userId, projectId, score, adminId }
 */
eventBus.on('workload:exceeded', async ({ userId, projectId, score, adminId }) => {
  log.info('workload:exceeded — triggering global rebalance', {
    userId:    userId?.toString(),
    projectId: projectId?.toString(),
    score,
  });

  try {
    const reassigned = await rebalanceTasks(projectId || null, MAX_WORKLOAD_SCORE, adminId);
    log.info('workload:exceeded — rebalance complete', { reassigned: reassigned.length });
  } catch (err) {
    log.error({ taskId: null, taskTitle: 'rebalance batch', err });
  }
});

log.info('workflowHandlers registered', {
  events: ['project:created', 'task:created', 'task:updated', 'leave:approved', 'workload:exceeded'],
});