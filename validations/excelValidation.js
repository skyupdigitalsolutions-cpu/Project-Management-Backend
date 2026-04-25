/**
 * validations/excelValidation.js
 * ─────────────────────────────────────────────────────────
 * Validates every row parsed from the Excel import.
 * Returns a { valid, errors } structure so the controller can
 * show the user exactly which rows failed and why.
 *
 * PLACE AT: validations/excelValidation.js
 *
 * EXPECTED EXCEL COLUMNS (case-insensitive):
 *  Task / Title       → task title
 *  Subtask            → subtask / sub-task label (optional)
 *  Role               → required designation (e.g. "Frontend Developer")
 *  Department         → required department (e.g. "Web Development")
 *  Priority           → low | medium | high | critical
 *  Duration           → number of days (positive integer)
 *  Dependency         → row number of parent task (optional, 1-based)
 *  Description        → free-text notes (optional)
 *  Module             → module/feature grouping (optional)
 */

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const MAX_TITLE_LEN    = 200;
const MAX_DESC_LEN     = 1000;
const MAX_DURATION     = 365;  // days

/**
 * Normalize a raw Excel cell value to string.
 * Returns '' for null / undefined.
 */
function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * Validates a single parsed row (0-indexed rowIndex for error messages).
 * @param {Object} row
 * @param {number} rowIndex   1-based row number for human-readable errors
 * @returns {{ isValid: boolean, errors: string[], cleaned: Object|null }}
 */
function validateRow(row, rowIndex) {
  const errors  = [];
  const cleaned = {};
  const r       = rowIndex; // shorthand

  // ── title (required) ────────────────────────────────────────────────────
  const title = str(row.title || row.task || row.Task || row.Title);
  if (!title) {
    errors.push(`Row ${r}: "Task/Title" is required`);
  } else if (title.length > MAX_TITLE_LEN) {
    errors.push(`Row ${r}: Title is too long (max ${MAX_TITLE_LEN} chars)`);
  } else {
    cleaned.title = title;
  }

  // ── subtask (optional) ───────────────────────────────────────────────────
  const subtask = str(row.subtask || row.Subtask || row.sub_task || row['Sub Task'] || row['Sub-Task']);
  cleaned.subtask = subtask || null;

  // ── role / required_role (required) ─────────────────────────────────────
  const role = str(row.role || row.Role || row.required_role || row['Required Role']);
  if (!role) {
    errors.push(`Row ${r}: "Role" is required`);
  } else {
    cleaned.required_role = role;
  }

  // ── department / required_department (required) ──────────────────────────
  const dept = str(row.department || row.Department || row.required_department || row['Department']);
  if (!dept) {
    errors.push(`Row ${r}: "Department" is required`);
  } else {
    cleaned.required_department = dept;
  }

  // ── priority (optional, default medium) ─────────────────────────────────
  const rawPriority = str(row.priority || row.Priority).toLowerCase();
  if (rawPriority && !VALID_PRIORITIES.includes(rawPriority)) {
    errors.push(`Row ${r}: "Priority" must be one of: ${VALID_PRIORITIES.join(', ')} (got "${rawPriority}")`);
  } else {
    cleaned.priority = VALID_PRIORITIES.includes(rawPriority) ? rawPriority : 'medium';
  }

  // ── duration in days (optional, default 1) ───────────────────────────────
  const rawDuration = row.duration || row.Duration || row['Duration (days)'] || 1;
  const duration    = parseInt(rawDuration, 10);
  if (isNaN(duration) || duration < 1) {
    errors.push(`Row ${r}: "Duration" must be a positive number (got "${rawDuration}")`);
  } else if (duration > MAX_DURATION) {
    errors.push(`Row ${r}: "Duration" cannot exceed ${MAX_DURATION} days`);
  } else {
    cleaned.estimated_days = duration;
    cleaned.estimated_hours = duration * 8; // default 8h working day
  }

  // ── dependency row number (optional) ────────────────────────────────────
  // Will be resolved to actual task _id after all tasks are saved
  const rawDep = row.dependency || row.Dependency || row['Depends On'] || row.depends_on;
  if (rawDep !== undefined && rawDep !== null && rawDep !== '') {
    const depNum = parseInt(rawDep, 10);
    if (isNaN(depNum) || depNum < 1) {
      errors.push(`Row ${r}: "Dependency" must be a positive row number (got "${rawDep}")`);
    } else {
      cleaned._dependencyRow = depNum; // resolved to _id after insert
    }
  }

  // ── description / notes (optional) ──────────────────────────────────────
  const desc = str(row.description || row.Description || row.notes || row.Notes);
  if (desc.length > MAX_DESC_LEN) {
    errors.push(`Row ${r}: "Description" is too long (max ${MAX_DESC_LEN} chars)`);
  } else {
    cleaned.description = desc || null;
  }

  // ── module_name (optional) ───────────────────────────────────────────────
  const mod = str(row.module || row.Module || row.module_name || row['Module']);
  cleaned.module_name = mod || null;

  return {
    isValid: errors.length === 0,
    errors,
    cleaned: errors.length === 0 ? cleaned : null,
  };
}

/**
 * Validates all rows from a parsed Excel sheet.
 *
 * @param {Object[]} rows  — array of row objects from xlsx parser
 * @returns {{
 *   validRows:   { index: number, data: Object }[],
 *   invalidRows: { index: number, errors: string[] }[],
 *   summary:     { total, valid, invalid }
 * }}
 */
function validateExcelRows(rows) {
  const validRows   = [];
  const invalidRows = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // Excel rows start at 2 (row 1 is header)
    const row    = rows[i];

    // Skip completely empty rows
    const hasContent = Object.values(row).some(
      (v) => v !== null && v !== undefined && String(v).trim() !== ''
    );
    if (!hasContent) continue;

    const { isValid, errors, cleaned } = validateRow(row, rowNum);

    if (isValid) {
      validRows.push({ index: rowNum, data: cleaned });
    } else {
      invalidRows.push({ index: rowNum, errors });
    }
  }

  return {
    validRows,
    invalidRows,
    summary: {
      total:   rows.length,
      valid:   validRows.length,
      invalid: invalidRows.length,
    },
  };
}

module.exports = { validateExcelRows, validateRow };