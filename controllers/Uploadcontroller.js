/**
 * controllers/uploadController.js
 * ─────────────────────────────────────────────────────────
 * Handles Excel task imports end-to-end:
 *   1. Parse Excel → JSON
 *   2. Validate every row
 *   3. Auto-assign each task (workload-aware)
 *   4. Bulk-insert tasks under the given projectId
 *   5. Resolve dependency references between tasks
 *   6. Fire notifications to assigned employees
 *   7. Clean up temp file
 *
 * PLACE AT: controllers/uploadController.js
 *
 * ROUTES (defined in routes/uploadRoutes.js):
 *   POST /api/upload/excel/:projectId   — import tasks from Excel
 *   GET  /api/upload/template           — download blank template
 *   GET  /api/upload/imports/:projectId — list past imports for a project
 */

const mongoose     = require('mongoose');
const Task         = require('../models/tasks');
const Project      = require('../models/project');
const Notification = require('../models/notification');
const User         = require('../models/users');

const { parseExcelFile, generateExcelTemplate } = require('../services/excelParserService');
const { validateExcelRows }                     = require('../validations/excelValidation');
const { assignBatch }                           = require('../services/excelAssignmentService');
const { cleanupExcelFile }                      = require('../middleware/excelUploadMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, err, code = 500) => {
  console.error('[UploadController]', err);
  return res.status(code).json({ success: false, message: err.message || 'Internal server error' });
};

// ─── POST /api/upload/excel/:projectId ────────────────────────────────────────

/**
 * Main Excel import handler.
 * Requires: multer file in req.file (field name "excel")
 * Body params:
 *   overwrite {boolean}  — if true, deletes existing Excel-imported tasks first
 */
const importFromExcel = async (req, res) => {
  const filePath  = req.file?.path;
  let   committed = false;

  try {
    const { projectId } = req.params;

    if (!isValidObjectId(projectId)) {
      cleanupExcelFile(filePath);
      return res.status(400).json({ success: false, message: 'Invalid projectId' });
    }

    // ── 1. Verify project exists ───────────────────────────────────────────
    const project = await Project.findById(projectId).lean();
    if (!project) {
      cleanupExcelFile(filePath);
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // ── 2. Parse Excel ─────────────────────────────────────────────────────
    let parsed;
    try {
      parsed = parseExcelFile(filePath);
    } catch (parseErr) {
      cleanupExcelFile(filePath);
      return res.status(422).json({ success: false, message: parseErr.message });
    }

    if (parsed.totalRows === 0) {
      cleanupExcelFile(filePath);
      return res.status(422).json({ success: false, message: 'Excel file has no data rows.' });
    }

    // ── 3. Validate rows ───────────────────────────────────────────────────
    const { validRows, invalidRows, summary } = validateExcelRows(parsed.rows);

    // If ALL rows are invalid → abort immediately
    if (validRows.length === 0) {
      cleanupExcelFile(filePath);
      return res.status(422).json({
        success:     false,
        message:     `All ${summary.total} rows failed validation. No tasks were imported.`,
        summary,
        errors:      invalidRows.map((r) => ({ row: r.index, errors: r.errors })),
      });
    }

    // ── 4. Handle overwrite ────────────────────────────────────────────────
    const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
    if (overwrite) {
      await Task.deleteMany({
        project_id:       projectId,
        is_auto_assigned: true,
        excel_import:     true,
      });
    }

    // ── 5. Auto-assign batch ───────────────────────────────────────────────
    const projectStart = project.start_date ? new Date(project.start_date) : new Date();
    const taskDocs     = await assignBatch(
      validRows,
      projectStart,
      projectId,
      req.user._id
    );

    // Mark every task as coming from an Excel import (for overwrite filtering)
    taskDocs.forEach((t) => { t.excel_import = true; });

    // ── 6. Bulk insert ─────────────────────────────────────────────────────
    const inserted = await Task.insertMany(
      taskDocs.map(({ _dependencyRow, ...rest }) => rest), // strip temp field
      { ordered: false }
    );

    committed = true;

    // ── 7. Resolve dependencies ────────────────────────────────────────────
    // _dependencyRow is a 1-based Excel row number → map to inserted _id
    const rowToId = {};  // excelRowIndex (1-based) → Task._id
    inserted.forEach((t, i) => {
      rowToId[validRows[i].index] = t._id;
    });

    const depUpdates = [];
    for (let i = 0; i < taskDocs.length; i++) {
      const depRow = taskDocs[i]._dependencyRow;
      if (depRow && rowToId[depRow]) {
        depUpdates.push(
          Task.findByIdAndUpdate(inserted[i]._id, {
            $set: { dependency_task_id: rowToId[depRow] },
          })
        );
      }
    }
    if (depUpdates.length > 0) await Promise.allSettled(depUpdates);

    // ── 8. Notify assigned employees ───────────────────────────────────────
    const assignedIds = [...new Set(
      inserted
        .map((t) => t.assigned_to?.toString())
        .filter(Boolean)
    )];

    if (assignedIds.length > 0) {
      const notifDocs = assignedIds.map((uid) => {
        const count = inserted.filter(
          (t) => t.assigned_to?.toString() === uid
        ).length;
        return {
          user_id:   uid,
          sender_id: req.user._id,
          message:   `📋 ${count} new task${count > 1 ? 's' : ''} assigned to you from Excel import for project "${project.title}"`,
          type:      'task_assigned',
          ref_type:  'Project',
          ref_id:    projectId,
        };
      });
      await Notification.insertMany(notifDocs).catch(console.error);
    }

    // ── 9. Cleanup temp file ───────────────────────────────────────────────
    cleanupExcelFile(filePath);

    // ── 10. Build response ─────────────────────────────────────────────────
    const assignedCount   = inserted.filter((t) => t.assigned_to).length;
    const unassignedCount = inserted.length - assignedCount;

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${inserted.length} task${inserted.length !== 1 ? 's' : ''} from Excel.`,
      summary: {
        ...summary,
        imported:    inserted.length,
        assigned:    assignedCount,
        unassigned:  unassignedCount,
        with_deps:   depUpdates.length,
        skipped_invalid: invalidRows.length,
      },
      invalid_rows: invalidRows.length > 0
        ? invalidRows.map((r) => ({ row: r.index, errors: r.errors }))
        : [],
      data: inserted.map((t) => ({
        _id:          t._id,
        title:        t.title,
        priority:     t.priority,
        status:       t.status,
        assigned_to:  t.assigned_to,
        start_date:   t.start_date,
        due_date:     t.due_date,
      })),
    });

  } catch (err) {
    if (!committed) cleanupExcelFile(filePath);
    return handleError(res, err);
  }
};

// ─── GET /api/upload/template ─────────────────────────────────────────────────

/** Download a blank Excel template with the correct columns pre-filled. */
const downloadTemplate = (_req, res) => {
  try {
    const buffer = generateExcelTemplate();
    res.setHeader('Content-Disposition', 'attachment; filename="task-import-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    handleError(res, err);
  }
};

// ─── GET /api/upload/imports/:projectId ───────────────────────────────────────

/**
 * Returns all Excel-imported tasks for a project.
 * Useful for the "re-import / overwrite?" confirmation dialog.
 */
const getImportedTasks = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidObjectId(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid projectId' });
    }

    const [tasks, total] = await Promise.all([
      Task.find({ project_id: projectId, excel_import: true })
        .populate('assigned_to', 'name email department designation')
        .sort({ start_date: 1, priority_score: -1 })
        .lean(),
      Task.countDocuments({ project_id: projectId, excel_import: true }),
    ]);

    return res.json({ success: true, total, data: tasks });
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = { importFromExcel, downloadTemplate, getImportedTasks };