/**
 * documentParser.js
 * Extracts text from uploaded documents and uses Claude API
 * to generate project description, tasks, and deliverables.
 */

const fs      = require("fs");
const path    = require("path");
const axios   = require("axios");
const pdfParse = require("pdf-parse");

// ── Text extraction ──────────────────────────────────────────────────────────

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const data   = await pdfParse(buffer);
    return data.text || "";
  }

  if ([".txt", ".doc", ".docx"].includes(ext)) {
    // For .txt — direct read. For .doc/.docx the caller should pre-convert;
    // fall back to raw utf-8 read which works for most simple docx text.
    return fs.readFileSync(filePath, "utf-8");
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// ── Claude API call ──────────────────────────────────────────────────────────

async function generateProjectDataFromText(documentText, existingTitle = "") {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set in .env");

  const prompt = `You are a project management assistant. Analyze the following document and extract structured project information.

Document:
"""
${documentText.slice(0, 8000)}
"""

Return ONLY valid JSON with this exact shape (no markdown, no code fences):
{
  "description": "A clear 2-3 sentence project description summarizing the objective and scope",
  "deliverables": ["deliverable 1", "deliverable 2", "deliverable 3"],
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to be done",
      "required_role": "frontend developer | backend developer | designer | content writer | seo specialist | data analyst | marketing specialist | mobile developer | full stack developer",
      "required_department": "Web Development | Design | SEO | Content Writing | Analytics | Social Media | Mobile",
      "priority": "low | medium | high | critical",
      "estimated_days": 1
    }
  ]
}

Rules:
- deliverables: 3-8 clear, measurable outcomes
- tasks: 5-15 tasks that cover the full project scope
- required_role must match one of the values listed exactly
- estimated_days: integer 1-5`;

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-opus-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );

  const raw = response.data.content[0]?.text || "";

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Claude returned invalid JSON — check prompt or document content");
  }

  return {
    description:  parsed.description  || "",
    deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
    tasks:        Array.isArray(parsed.tasks)        ? parsed.tasks        : [],
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an uploaded file and return structured project data.
 * @param {string} filePath  - Absolute path to uploaded file
 * @param {string} [title]   - Optional project title for context
 * @returns {{ description, deliverables, tasks, rawText }}
 */
async function parseProjectDocument(filePath, title = "") {
  const rawText   = await extractTextFromFile(filePath);
  const generated = await generateProjectDataFromText(rawText, title);
  return { ...generated, rawText };
}

module.exports = { parseProjectDocument, extractTextFromFile };