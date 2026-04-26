/**
 * services/excelService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * High-level import logic: parse an Excel file, validate rows,
 * deduplicate against the DB, and bulk-insert Tasks.
 *
 * Depends on:
 *   - services/excelParserService.js  (low-level xlsx → JSON)
 *   - models/tasks.js
 *   - models/users.js
 */

const { parseExcelFile } = require('./excelParserService');
const Task  = require('../models/tasks');
const User  = require('../models/users');
const mongoose = require('mongoose');

// ─── Column name aliases ──────────────────────────────────────────────────────
// Normalised keys from parseExcelFile are lowercase_underscored.
// We support several common spelling variants here.

function getField(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  return null;
}

// ─── Role → user lookup cache (per import session) ────────────────────────────

const roleCache = new Map();

async function findUserByRole(role) {
  if (!role) return null;
  const key = role.toLowerCase().trim();
  if (roleCache.has(key)) return roleCache.get(key);

  const user = await User.findOne({
    role:   'employee',
    status: 'active',
    $or: [
      { designation: { $regex: key, $options: 'i' } },
      { department:  { $regex: key, $options: 'i' } },
    ],
  }).select('_id name designation');

  roleCache.set(key, user || null);
  return user || null;
}

// ─── Duplicate check ──────────────────────────────────────────────────────────

/**
 * Check if a task with the same title already exists in the project.
 * Returns true if duplicate.
 */
async function isDuplicate(projectId, title) {
  const exists = await Task.exists({
    project_id: projectId,
    title:      { $regex: `^${title.trim()}$`, $options: 'i' },
  });
  return !!exists;
}

// ─── Main import function ─────────────────────────────────────────────────────

/**
 * importTasksFromExcel(filePath, projectId, importedByUserId)
 *
 * @param {string} filePath         — absolute path to uploaded .xlsx/.xls
 * @param {string} projectId        — target project ObjectId string
 * @param {string} importedByUserId — admin/manager performing the import
 * @returns {{
 *   imported: number,
 *   skipped:  number,
 *   errors:   Array<{ row: number, reason: string }>,
 *   tasks:    Object[]
 * }}
 */
async function importTasksFromExcel(filePath, projectId, importedByUserId) {
  // Clear role cache for this import session
  roleCache.clear();

  // 1. Parse the file
  const { rows } = parseExcelFile(filePath);

  const results = {
    imported: 0,
    skipped:  0,
    errors:   [],
    tasks:    [],
  };

  const taskDocs = [];

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i + 2; // 1-indexed + header row

    // ── Required field: title ────────────────────────────────────────────────
    const title = getField(row, 'task', 'title', 'task_title', 'Task', 'Title');
    if (!title) {
      results.errors.push({ row: rowNum, reason: 'Missing required field: Task / Title' });
      results.skipped++;
      continue;
    }

    // ── Duplicate check ──────────────────────────────────────────────────────
    const dup = await isDuplicate(projectId, String(title));
    if (dup) {
      results.errors.push({ row: rowNum, reason: `Duplicate: task "${title}" already exists in project` });
      results.skipped++;
      continue;
    }

    // ── Optional fields ──────────────────────────────────────────────────────
    const subtask     = getField(row, 'subtask', 'Subtask', 'sub_task');
    const role        = getField(row, 'role', 'Role', 'required_role', 'designation');
    const department  = getField(row, 'department', 'Department', 'dept');
    const priority    = getField(row, 'priority', 'Priority') || 'medium';
    const description = getField(row, 'description', 'Description', 'notes', 'Notes');
    const moduleName  = getField(row, 'module', 'Module', 'module_name');

    // Duration → due_date calculation
    const durationDays = parseInt(getField(row, 'duration_(days)', 'duration', 'Duration_(days)', 'Duration', 'days'), 10);
    const dueDate      = new Date();
    dueDate.setDate(dueDate.getDate() + (isNaN(durationDays) ? 3 : durationDays));

    // ── Role → user lookup ───────────────────────────────────────────────────
    let assignedTo = null;
    if (role) {
      const user = await findUserByRole(role);
      if (user) assignedTo = user._id;
    }

    // ── Validate priority ────────────────────────────────────────────────────
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const normPriority = String(priority).toLowerCase().trim();
    const safePriority = validPriorities.includes(normPriority) ? normPriority : 'medium';

    const taskDoc = {
      project_id:          projectId,
      title:               String(title).trim(),
      description:         description ? String(description).trim() : null,
      assigned_to:         assignedTo,
      assigned_by:         importedByUserId,
      required_role:       role       ? String(role).trim()       : null,
      required_department: department ? String(department).trim() : null,
      module_name:         moduleName ? String(moduleName).trim() : null,
      priority:            safePriority,
      status:              assignedTo ? 'todo' : 'unassigned',
      due_date:            dueDate,
      estimated_days:      isNaN(durationDays) ? 3 : durationDays,
      excel_import:        true,
      is_auto_assigned:    !!assignedTo,
      auto_assign_reason:  assignedTo
        ? `Excel import — matched role: ${role}`
        : 'Excel import — no matching employee found',
      // Attach subtask string to first subtask entry if provided
      subtasks: subtask ? [{ title: String(subtask).trim(), status: 'todo', priority: safePriority }] : [],
    };

    taskDocs.push(taskDoc);
  }

  // ── Bulk insert ────────────────────────────────────────────────────────────
  if (taskDocs.length > 0) {
    try {
      const inserted = await Task.insertMany(taskDocs, { ordered: false });
      results.imported = inserted.length;
      results.tasks    = inserted;
    } catch (bulkErr) {
      // ordered:false — partial success possible
      if (bulkErr.insertedDocs) {
        results.imported = bulkErr.insertedDocs.length;
        results.tasks    = bulkErr.insertedDocs;
      }
      results.errors.push({ row: 'bulk', reason: bulkErr.message });
    }
  }

  return results;
}

module.exports = { importTasksFromExcel };
