/**
 * controllers/excelTemplateController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages a single globally-stored Excel template.
 * Upload once → reuse on any project's "Auto-Generate from Excel" step.
 *
 * ENDPOINTS (register in your routes index):
 *   POST /api/excel-template          — upload/replace global template
 *   GET  /api/excel-template          — get stored template metadata
 *   GET  /api/excel-template/tasks    — parse & return tasks from stored template
 *
 * Reuses your existing:
 *   - services/excelParserService.js  (parseExcelFile)
 *   - middleware/excelUploadMiddleware.js (uploadExcel, cleanupExcelFile)
 */

const fs   = require('fs')
const path = require('path')

// ── Reuse your existing Excel parser ─────────────────────────────────────────
const { parseExcelFile }    = require('../services/excelParserService')
const { cleanupExcelFile }  = require('../middleware/excelUploadMiddleware')

// ── In-memory store for the template metadata ─────────────────────────────────
// A simple JSON file acts as a lightweight persistent store so we don't need
// a new Mongoose model. It lives in uploads/excel/global-template-meta.json.
// If you prefer a DB record, swap the load/save helpers with Mongoose calls.

const META_DIR  = path.join(__dirname, '../uploads/excel')
const META_FILE = path.join(META_DIR, 'global-template-meta.json')

function ensureMetaDir() {
  if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true })
}

function loadMeta() {
  try {
    if (fs.existsSync(META_FILE)) {
      return JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
    }
  } catch (_) {}
  return null
}

function saveMeta(meta) {
  ensureMetaDir()
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8')
}

function deleteMeta() {
  if (fs.existsSync(META_FILE)) fs.unlinkSync(META_FILE)
}

// ─── POST /api/excel-template ─────────────────────────────────────────────────
/**
 * Accepts multipart/form-data with field "file".
 * Replaces any previously stored template (deletes old file from disk).
 */
const uploadTemplate = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Field name must be "file".' })
    }

    const { originalname, filename, mimetype, size, path: filePath } = req.file

    // Delete the old stored file from disk to avoid orphans
    const existing = loadMeta()
    if (existing?.path && existing.path !== filePath) {
      const oldAbs = path.resolve(existing.path)
      if (fs.existsSync(oldAbs)) {
        try { fs.unlinkSync(oldAbs) } catch (_) {}
      }
    }

    const meta = {
      filename,
      originalName: originalname,
      mimetype,
      size,
      path:       filePath,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user?._id?.toString() ?? null,
    }

    saveMeta(meta)

    console.log(`[ExcelTemplate] New global template stored: ${originalname}`)

    return res.status(200).json({
      success: true,
      message: 'Global Excel template stored. It will be used for auto-task generation on all projects.',
      data: {
        originalName: meta.originalName,
        filename:     meta.filename,
        size:         meta.size,
        uploadedAt:   meta.uploadedAt,
      },
    })
  } catch (err) {
    console.error('[ExcelTemplate] uploadTemplate error:', err)
    // Clean up the just-uploaded temp file if something went wrong
    if (req.file?.path) cleanupExcelFile(req.file.path)
    return res.status(500).json({ success: false, message: 'Failed to store template.' })
  }
}

// ─── GET /api/excel-template ──────────────────────────────────────────────────
/** Returns metadata of the currently stored global template (or null). */
const getTemplate = (req, res) => {
  try {
    const meta = loadMeta()

    if (!meta) {
      return res.status(200).json({ success: true, data: null })
    }

    // Check if the file still physically exists
    if (!fs.existsSync(path.resolve(meta.path))) {
      deleteMeta()
      return res.status(200).json({ success: true, data: null })
    }

    return res.status(200).json({
      success: true,
      data: {
        originalName: meta.originalName,
        filename:     meta.filename,
        size:         meta.size,
        uploadedAt:   meta.uploadedAt,
      },
    })
  } catch (err) {
    console.error('[ExcelTemplate] getTemplate error:', err)
    return res.status(500).json({ success: false, message: 'Failed to retrieve template info.' })
  }
}

// ─── GET /api/excel-template/tasks ───────────────────────────────────────────
/**
 * Parses the stored global template and returns its rows as task objects.
 * The frontend uses this to show a selectable task list in the wizard.
 *
 * Response shape:
 * {
 *   success: true,
 *   template: { originalName, uploadedAt },
 *   data: [
 *     {
 *       id:             "row-3",          // stable client-side key
 *       title:          "Design Homepage",
 *       subtask:        "",
 *       required_role:  "UI Designer",
 *       department:     "Design",
 *       priority:       "high",
 *       estimated_hours:"3 days",
 *       dependency:     "",
 *       description:    "...",
 *       module:         "Frontend",
 *       due_date:       "",
 *     },
 *     ...
 *   ]
 * }
 */
const getTemplateTasks = (req, res) => {
  try {
    const meta = loadMeta()

    if (!meta) {
      return res.status(200).json({
        success:  true,
        template: null,
        data:     [],
        message:  'No global template stored yet.',
      })
    }

    const absPath = path.resolve(meta.path)
    if (!fs.existsSync(absPath)) {
      deleteMeta()
      return res.status(200).json({
        success:  true,
        template: null,
        data:     [],
        message:  'Stored template file not found. Please re-upload.',
      })
    }

    // Parse using your existing service
    let parsed
    try {
      parsed = parseExcelFile(absPath)
    } catch (parseErr) {
      return res.status(422).json({
        success: false,
        message: `Template parse error: ${parseErr.message}`,
      })
    }

    if (parsed.totalRows === 0) {
      return res.status(200).json({
        success:  true,
        template: { originalName: meta.originalName, uploadedAt: meta.uploadedAt },
        data:     [],
        message:  'Template has no data rows.',
      })
    }

    // Normalise rows → task-shaped objects the frontend understands
    const tasks = parsed.rows.map((row, idx) => {
      // parsed.rows come from your validateExcelRows / parseExcelFile;
      // they already have camelCase or snake_case keys depending on your parser.
      // We expose a consistent shape here.
      const r = row.data ?? row // support both {index, data} and flat row shapes

      const priority = normalisePriority(r.priority ?? r.Priority)

      return {
        // Stable id for the frontend checkbox list (no DB yet)
        id:             `row-${row.index ?? idx + 1}`,

        // Core fields
        title:          r.title          ?? r.task          ?? r.Task          ?? '',
        subtask:        r.subtask        ?? r.subTask       ?? r.Subtask       ?? '',
        required_role:  r.required_role  ?? r.role          ?? r.Role          ?? '',
        department:     r.department     ?? r.Department    ?? '',
        priority,
        estimated_hours:r.estimated_hours ?? r.duration     ?? r.Duration      ?? '',
        dependency:     r.dependency     ?? r.Dependency    ?? '',
        description:    r.description    ?? r.Description   ?? r.notes         ?? '',
        module:         r.module         ?? r.Module        ?? r.category      ?? '',
        due_date:       r.due_date       ?? r.dueDate       ?? r['Due Date']   ?? '',
      }
    }).filter(t => t.title) // drop blank rows

    return res.status(200).json({
      success:  true,
      template: {
        originalName: meta.originalName,
        uploadedAt:   meta.uploadedAt,
      },
      data: tasks,
    })
  } catch (err) {
    console.error('[ExcelTemplate] getTemplateTasks error:', err)
    return res.status(500).json({ success: false, message: 'Failed to parse template tasks.' })
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function normalisePriority(raw) {
  if (!raw) return 'medium'
  const v = String(raw).toLowerCase().trim()
  if (['low', 'medium', 'high', 'critical'].includes(v)) return v
  // Map common aliases
  if (v === 'urgent' || v === 'highest') return 'critical'
  if (v === 'normal')                    return 'medium'
  if (v === 'minor' || v === 'lowest')   return 'low'
  return 'medium'
}

module.exports = { uploadTemplate, getTemplate, getTemplateTasks }