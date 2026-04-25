/**
 * services/excelParserService.js
 * ─────────────────────────────────────────────────────────
 * Reads an .xlsx / .xls file from disk and converts it to
 * an array of plain objects using the xlsx library.
 *
 * PLACE AT: services/excelParserService.js
 *
 * INSTALL: npm install xlsx
 *
 * COLUMN NAME NORMALISATION:
 *  Headers are trimmed and lowercased before returning,
 *  so "Task Title ", "task title", "TASK TITLE" all become "task title".
 *  The validation layer handles the key aliases.
 */

const xlsx = require('xlsx');
const path = require('path');

/**
 * Parse an Excel file and return its first sheet as an array of objects.
 *
 * @param {string} filePath  — absolute path to the uploaded file
 * @returns {{
 *   rows:        Object[],   // raw row objects, keys = header values
 *   sheetName:   string,     // name of the sheet that was parsed
 *   totalRows:   number,
 *   headers:     string[],   // normalised column headers found
 *   rawHeaders:  string[],   // original column headers before normalisation
 * }}
 */
function parseExcelFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Validate extension at runtime (belt-and-suspenders after middleware)
  if (!['.xlsx', '.xls'].includes(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Only .xlsx and .xls are accepted.`);
  }

  let workbook;
  try {
    workbook = xlsx.readFile(filePath, {
      cellDates:  true,   // parse date cells as JS Date objects
      defval:     null,   // empty cells → null instead of undefined
      raw:        false,  // format numbers as strings for consistent parsing
    });
  } catch (err) {
    throw new Error(`Failed to read Excel file: ${err.message}`);
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Excel file contains no sheets.');
  }

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" could not be read.`);
  }

  // Convert to array of objects — first row treated as header
  const rawRows = xlsx.utils.sheet_to_json(sheet, {
    defval:  null,
    raw:     false,
    blankrow: false,
  });

  if (rawRows.length === 0) {
    throw new Error('The Excel sheet is empty. Please add at least one data row below the header.');
  }

  // Capture original headers
  const rawHeaders = Object.keys(rawRows[0]);

  // Normalise keys: trim + lowercase + collapse spaces
  const rows = rawRows.map((row) => {
    const normalised = {};
    for (const [k, v] of Object.entries(row)) {
      const normKey = k.trim().toLowerCase().replace(/\s+/g, '_');
      normalised[normKey] = v;
      // Also keep original key for flexible lookup in validation
      normalised[k.trim()] = v;
    }
    return normalised;
  });

  return {
    rows,
    sheetName,
    totalRows:  rows.length,
    headers:    rows.length > 0 ? Object.keys(rows[0]).filter(k => !rawHeaders.includes(k)) : [],
    rawHeaders,
  };
}

/**
 * Returns a downloadable sample Excel buffer (for the frontend "Download Template" button).
 * Generates an .xlsx file with the correct column headers + one example row.
 */
function generateExcelTemplate() {
  const wb = xlsx.utils.book_new();

  const sampleData = [
    {
      Task:         'Design UI mockups',
      Subtask:      'Homepage wireframe',
      Role:         'UI Designer',
      Department:   'Design',
      Priority:     'high',
      'Duration (days)': 3,
      Dependency:   '',
      Description:  'Create wireframes using Figma',
      Module:       'Frontend',
    },
    {
      Task:         'Develop REST API',
      Subtask:      'User authentication endpoints',
      Role:         'Backend Developer',
      Department:   'Web Development',
      Priority:     'critical',
      'Duration (days)': 5,
      Dependency:   '',
      Description:  'JWT-based auth with refresh tokens',
      Module:       'Backend',
    },
    {
      Task:         'Frontend integration',
      Subtask:      'Connect login page to API',
      Role:         'Frontend Developer',
      Department:   'Web Development',
      Priority:     'high',
      'Duration (days)': 2,
      Dependency:   2,    // depends on row 2 (Develop REST API)
      Description:  'Integrate auth API with React context',
      Module:       'Frontend',
    },
  ];

  const ws = xlsx.utils.json_to_sheet(sampleData);

  // Column widths
  ws['!cols'] = [
    { wch: 30 }, // Task
    { wch: 35 }, // Subtask
    { wch: 25 }, // Role
    { wch: 25 }, // Department
    { wch: 12 }, // Priority
    { wch: 16 }, // Duration
    { wch: 12 }, // Dependency
    { wch: 40 }, // Description
    { wch: 20 }, // Module
  ];

  xlsx.utils.book_append_sheet(wb, ws, 'Tasks');

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseExcelFile, generateExcelTemplate };