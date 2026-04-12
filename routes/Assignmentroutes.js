const express = require("express");
const router = express.Router();
const {
  createProjectWizard,
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  addMember,
  removeMember,
  getAssignmentTasks,
} = require("../controllers/Assignmentcontroller");
const { protect, authorise } = require("../middleware/authMiddleware");

// ── Wizard endpoint ────────────────────────────────────────────────────────────
// POST   /api/assignments/wizard    — Admin/Manager: create full project in one shot
router.post("/wizard", protect, authorise("admin", "manager"), createProjectWizard);

// ── Assignment CRUD ───────────────────────────────────────────────────────────
// POST   /api/assignments           — Admin/Manager: create single assignment
// GET    /api/assignments           — Protected: list assignments (?project_id &status)
// GET    /api/assignments/:id       — Protected: full detail with members + tasks
// PATCH  /api/assignments/:id       — Admin/Manager: update assignment
// DELETE /api/assignments/:id       — Admin/Manager: delete + cascade

router.post("/",    protect, authorise("admin", "manager"), createAssignment);
router.get("/",     protect, getAssignments);
router.get("/:id",  protect, getAssignmentById);
router.patch("/:id",  protect, authorise("admin", "manager"), updateAssignment);
router.delete("/:id", protect, authorise("admin", "manager"), deleteAssignment);

// ── Assignment Members ─────────────────────────────────────────────────────────
// POST   /api/assignments/:id/members            — Admin/Manager: add member
// DELETE /api/assignments/:id/members/:user_id   — Admin/Manager: remove member
router.post("/:id/members",             protect, authorise("admin", "manager"), addMember);
router.delete("/:id/members/:user_id",  protect, authorise("admin", "manager"), removeMember);

// ── Assignment Tasks ──────────────────────────────────────────────────────────
// GET    /api/assignments/:id/tasks   — Protected: tasks for an assignment
router.get("/:id/tasks", protect, getAssignmentTasks);

module.exports = router;
