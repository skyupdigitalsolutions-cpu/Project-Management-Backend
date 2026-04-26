/**
 * middleware/uploadMiddleware.js
 *
 * Exports:
 *   module.exports              (default) — general-purpose multer instance
 *                                           (.single / .array / .fields usable directly)
 *   module.exports.uploadUserDocs         — (req,res,next) for POST /users/:id/documents
 *   module.exports.uploadDesignationDoc   — (req,res,next) for PATCH /users/:id/designation
 *   module.exports.uploadExcel            — (req,res,next) for Excel import routes
 *
 * All named exports are proper Express middleware functions — never pre-invoked.
 * req.files (fields) / req.file (single) are set before the controller runs.
 */

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Directory helpers ─────────────────────────────────────────────────────────

const ensure = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const UPLOAD_DIR    = ensure(path.join(__dirname, '..', 'uploads'));
const USER_DOCS_DIR = ensure(path.join(UPLOAD_DIR, 'user-docs'));
const EXCEL_DIR     = ensure(path.join(UPLOAD_DIR, 'excel'));

// ── Storage engines ───────────────────────────────────────────────────────────

const generalStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const userDocStorage = multer.diskStorage({
  destination: (_req, file, cb) => {
    const subDir = ensure(path.join(USER_DOCS_DIR, file.fieldname));
    cb(null, subDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const excelStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EXCEL_DIR),
  filename:    (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});

// ── File filters ──────────────────────────────────────────────────────────────

const generalFilter = (_req, file, cb) => {
  const allowed = [
    '.pdf', '.doc', '.docx', '.txt',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
    '.zip',
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext)
    ? cb(null, true)
    : cb(new Error(`File type "${ext}" is not allowed`), false);
};

const userDocFilter = (_req, file, cb) => {
  const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext)
    ? cb(null, true)
    : cb(new Error(`User documents must be PDF or image files (got "${ext}")`), false);
};

const excelFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  ['.xlsx', '.xls'].includes(ext)
    ? cb(null, true)
    : cb(new Error('Only .xlsx and .xls Excel files are accepted'), false);
};

// ── Base multer instances ─────────────────────────────────────────────────────

const generalMulter = multer({
  storage:    generalStorage,
  fileFilter: generalFilter,
  limits:     { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const userDocMulter = multer({
  storage:    userDocStorage,
  fileFilter: userDocFilter,
  limits:     { fileSize: 5 * 1024 * 1024 },  // 5 MB per file
});

const excelMulter = multer({
  storage:    excelStorage,
  fileFilter: excelFilter,
  limits:     { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── Shared error handler ──────────────────────────────────────────────────────

const handleMulterError = (err, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError || err.message) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
};

// ── Named middleware exports ──────────────────────────────────────────────────

/**
 * uploadUserDocs
 * Handles all document fields for POST /users/:id/documents.
 * Sets req.files = { fieldname: [multerFileObj, ...], ... }
 */
const USER_DOC_FIELDS = [
  { name: 'aadhaar',               maxCount: 1 },
  { name: 'pan',                   maxCount: 1 },
  { name: 'resume',                maxCount: 1 },
  { name: 'offerLetter',           maxCount: 1 },
  { name: 'salarySlip',            maxCount: 1 },
  { name: 'experienceCertificate', maxCount: 1 },
  { name: 'certificates',          maxCount: 5 },
];

const uploadUserDocs = (req, res, next) =>
  userDocMulter.fields(USER_DOC_FIELDS)(req, res, (err) => handleMulterError(err, res, next));

/**
 * uploadDesignationDoc
 * Single optional file for PATCH /users/:id/designation.
 * Sets req.file (multer single-file object) or leaves it undefined.
 */
const uploadDesignationDoc = (req, res, next) =>
  userDocMulter.single('supportingDoc')(req, res, (err) => handleMulterError(err, res, next));

/**
 * uploadExcel
 * Single Excel file for bulk-import routes.
 * Sets req.file.
 */
const uploadExcel = (req, res, next) =>
  excelMulter.single('file')(req, res, (err) => handleMulterError(err, res, next));

// ── Exports ───────────────────────────────────────────────────────────────────

// Default export kept for backward-compat:
//   const upload = require('./uploadMiddleware');
//   router.post('/...', upload.single('file'), handler);  ✅ still works
module.exports                      = generalMulter;
module.exports.uploadUserDocs       = uploadUserDocs;
module.exports.uploadDesignationDoc = uploadDesignationDoc;
module.exports.uploadExcel          = uploadExcel;