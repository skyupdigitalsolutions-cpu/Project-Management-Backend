/**
 * middleware/excelUploadMiddleware.js
 * ─────────────────────────────────────────────────────────
 * Dedicated upload middleware for Excel files ONLY.
 * Keeps the existing uploadMiddleware.js untouched.
 *
 * PLACE AT: middleware/excelUploadMiddleware.js
 *
 * SECURITY:
 *  - Accepts ONLY .xlsx / .xls files
 *  - Validates MIME type (not just extension)
 *  - Hard 5MB limit (Excel plans don't need to be bigger)
 *  - Stored in /uploads/excel/ subfolder, auto-deleted after parsing
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const EXCEL_DIR = path.join(__dirname, '../uploads/excel');
if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });

const ALLOWED_EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
  'application/octet-stream',                                          // some OS sends this for .xlsx
];

const ALLOWED_EXCEL_EXTS = ['.xlsx', '.xls'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EXCEL_DIR),
  filename:    (_req, file, cb) => {
    const stamp  = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, `excel-import-${stamp}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXCEL_EXTS.includes(ext)) {
    return cb(new Error(`Only .xlsx and .xls files are allowed. Got: ${ext}`), false);
  }
  if (!ALLOWED_EXCEL_MIMES.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type. Expected Excel MIME, got: ${file.mimetype}`), false);
  }
  cb(null, true);
};

const excelUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
    files:    1,               // single file per import
  },
});

/** Middleware that wraps multer + returns clean 400 on error */
function uploadExcel(req, res, next) {
  excelUpload.single('excel')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ success: false, message: 'Excel file must be under 5MB' });
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    }
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file)
      return res.status(400).json({ success: false, message: 'No Excel file uploaded. Field name must be "excel"' });
    next();
  });
}

/** Deletes the temp file after parsing (call in controller) */
function cleanupExcelFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn('[ExcelUpload] Cleanup failed:', e.message);
  }
}

module.exports = { uploadExcel, cleanupExcelFile };