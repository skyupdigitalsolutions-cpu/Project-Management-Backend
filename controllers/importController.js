/**
 * controllers/importController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles Excel upload → parse → store.
 *
 * Routes (registered in routes/Index.js under /import):
 *   POST /import/tasks/:projectId   — upload .xlsx and import tasks
 *   GET  /import/template           — download sample .xlsx template
 */

const mongoose  = require('mongoose');
const fs        = require('fs');
const { importTasksFromExcel }   = require('../services/excelService');
const { generateExcelTemplate }  = require('../services/excelParserService');
const Project = require('../models/project');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || 'Internal server error' });
};

// ─── IMPORT TASKS FROM EXCEL ──────────────────────────────────────────────────

/**
 * POST /import/tasks/:projectId
 *
 * Multipart form-data:
 *   file — Excel file (.xlsx or .xls)
 *
 * Validates:
 *   - projectId exists
 *   - file uploaded
 *   - file is .xlsx or .xls
 * Then calls excelService.importTasksFromExcel.
 * Cleans up the uploaded temp file after import.
 */
const importTasksFromExcelController = async (req, res) => {
  const filePath = req.file?.path || null;

  try {
    const { projectId } = req.params;

    if (!isValidObjectId(projectId)) {
      return res.status(400).json({ success: false, message: 'Invalid projectId' });
    }

    const project = await Project.findById(projectId).select('_id title');
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Send an Excel file in the "file" field.' });
    }

    const ext = req.file.originalname.toLowerCase().split('.').pop();
    if (!['xlsx', 'xls'].includes(ext)) {
      return res.status(400).json({ success: false, message: 'Only .xlsx and .xls files are supported' });
    }

    const results = await importTasksFromExcel(
      req.file.path,
      projectId,
      req.user._id
    );

    return res.status(200).json({
      success:   true,
      projectId,
      projectTitle: project.title,
      imported:  results.imported,
      skipped:   results.skipped,
      errors:    results.errors,
      message:   `Import complete. ${results.imported} task(s) imported, ${results.skipped} skipped.`,
    });
  } catch (error) {
    return handleError(res, error);
  } finally {
    // Always clean up the uploaded file
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  }
};

// ─── DOWNLOAD TEMPLATE ────────────────────────────────────────────────────────

/**
 * GET /import/template
 * Returns a downloadable .xlsx template with correct column headers.
 */
const downloadTemplate = async (req, res) => {
  try {
    const buffer = generateExcelTemplate();
    res.setHeader('Content-Disposition', 'attachment; filename="task_import_template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = { importTasksFromExcelController, downloadTemplate };
