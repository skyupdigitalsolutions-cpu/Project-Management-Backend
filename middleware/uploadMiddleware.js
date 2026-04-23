const multer = require("multer");
const path   = require("path");
const fs     = require("fs");

const UPLOAD_DIR = path.join(__dirname, "../uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

// Extended file types: docs + images + spreadsheets + zip (for email attachments)
const fileFilter = (_req, file, cb) => {
  const allowed = [
    // Documents
    ".pdf", ".doc", ".docx", ".txt",
    // Images
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    // Spreadsheets & Presentations
    ".xls", ".xlsx", ".csv", ".ppt", ".pptx",
    // Archives
    ".zip",
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error(`File type "${ext}" is not allowed`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
});

module.exports = upload;