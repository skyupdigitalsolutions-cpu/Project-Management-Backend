const express = require("express");
const router  = express.Router();


const { protect, authorise } = require("../middleware/authMiddleware");
const {
  autoplanPreview,
  createProjectWizard,
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  addMember,
  removeMember,
  getAssignmentTasks,
  autoAssignFromDocument,
  autoAssignForProject,
} = require("../controllers/Assignmentcontroller");

// ── NEW: Task Generation & Smart Assignment ───────────────────────────────────
const {
  getSupportedAssignmentTypes,
  generateTaskPreview,
  confirmGenerateTasks,
  getAssignmentWorkload,
  deleteAssignmentTasks,
} = require("../controllers/assignmentTaskController");


router.post(
  "/auto-plan-preview",
  protect,
  authorise("admin", "manager"),
  autoplanPreview
);


router.post(
  "/wizard",
  protect,
  authorise("admin", "manager"),
  createProjectWizard
);

router.post("/auto-assign-from-document", protect, authorise("admin", "manager"), autoAssignFromDocument);

router.post("/auto-assign/:project_id", protect, authorise("admin", "manager"), autoAssignForProject);


router.get("/supported-types", protect, getSupportedAssignmentTypes);

// ── Single assignment CRUD ────────────────────────────────────────────────────
router.post("/",      protect, authorise("admin", "manager"), createAssignment);
router.get("/",       protect, getAssignments);
router.get("/:id",    protect, getAssignmentById);
router.patch("/:id",  protect, authorise("admin", "manager"), updateAssignment);
router.delete("/:id", protect, authorise("admin", "manager"), deleteAssignment);

// ── Assignment members ─────────────────────────────────────────────────────────
router.post("/:id/members",            protect, authorise("admin", "manager"), addMember);
router.delete("/:id/members/:user_id", protect, authorise("admin", "manager"), removeMember);

// ── Assignment tasks (existing) ────────────────────────────────────────────────
router.get("/:id/tasks", protect, getAssignmentTasks);


router.post(
  "/:id/generate-tasks/preview",
  protect,
  authorise("admin", "manager"),
  generateTaskPreview
);


router.post(
  "/:id/generate-tasks/confirm",
  protect,
  authorise("admin", "manager"),
  confirmGenerateTasks
);


router.get(
  "/:id/workload",
  protect,
  authorise("admin", "manager"),
  getAssignmentWorkload
);


router.delete(
  "/:id/tasks",
  protect,
  authorise("admin", "manager"),
  deleteAssignmentTasks
);




module.exports = router;