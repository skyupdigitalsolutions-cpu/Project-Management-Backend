

function ts() {
  return new Date().toISOString();
}

function fmt(level, data) {
  return JSON.stringify({ level, ts: ts(), ...data });
}

// ─── Log functions ────────────────────────────────────────────────────────────

function assign({ taskId, taskTitle, userId, userName, reason, workloadScore, trigger = 'auto_assign' }) {
  console.log(fmt('ASSIGN', {
    trigger,
    taskId:       taskId?.toString(),
    taskTitle,
    assignedTo:   userId?.toString(),
    assigneeName: userName,
    reason,
    workloadScore,
  }));
}

function skip({ taskId, taskTitle, reason }) {
  console.warn(fmt('SKIP', {
    taskId:    taskId?.toString(),
    taskTitle,
    reason,
  }));
}

function rebalance({ taskId, taskTitle, fromUserId, fromUserName, toUserId, toUserName, reason }) {
  console.log(fmt('REBALANCE', {
    taskId:       taskId?.toString(),
    taskTitle,
    fromUser:     fromUserId?.toString(),
    fromUserName,
    toUser:       toUserId?.toString(),
    toUserName,
    reason,
  }));
}

function leaveReassign({ taskId, taskTitle, fromUserId, fromUserName, toUserId, toUserName }) {
  console.log(fmt('LEAVE_REASSIGN', {
    taskId:       taskId?.toString(),
    taskTitle,
    fromUser:     fromUserId?.toString(),
    fromUserName,
    toUser:       toUserId?.toString(),
    toUserName,
  }));
}

function error({ taskId, taskTitle, err }) {
  console.error(fmt('ERROR', {
    taskId:    taskId?.toString(),
    taskTitle,
    error:     err?.message || String(err),
    stack:     err?.stack?.split('\n')[1]?.trim(),
  }));
}

function info(message, data = {}) {
  console.log(fmt('INFO', { message, ...data }));
}

module.exports = { assign, skip, rebalance, leaveReassign, error, info };