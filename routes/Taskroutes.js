const express = require("express");
const router  = express.Router();

const {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
  bulkUpdateStatus,
  logDelay,
  updateProgress,
  handlePermission,
  requestPermission,
  reassignTask,
  getTaskStats,
  getWorkloadOverview,
} = require("../controllers/taskController");
const { protect, authorise } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

// ── Utility / collection routes ───────────────────────────────────────────────
router.get( "/stats",        protect, getTaskStats); // scoped per role inside controller
router.get( "/workload",     protect, authorise("admin", "manager"), getWorkloadOverview);
router.post("/bulk-status",  protect, authorise("admin", "manager"), bulkUpdateStatus);

// ── Main CRUD ─────────────────────────────────────────────────────────────────
router.post("/",    protect, authorise("admin", "manager"), createTask);
router.get( "/",    protect, getAllTasks);
router.get( "/:id", protect, getTaskById);
router.patch("/:id",protect, updateTask);
router.delete("/:id", protect, authorise("admin", "manager"), deleteTask);

// ── Progress tracking ─────────────────────────────────────────────────────────
router.patch("/:id/progress", protect, updateProgress);

// ── Delay logging ─────────────────────────────────────────────────────────────
router.post("/:id/delay", protect, logDelay);

// ── Permission: Admin grants or denies ────────────────────────────────────────
router.patch("/:id/permission", protect, authorise("admin"), handlePermission);

// ── Permission: Employee requests permission on a blocked task ────────────────
// POST /api/tasks/:id/request-permission
// Body: { reason: "I need access to the staging server to complete this task" }
router.post("/:id/request-permission", protect, upload.array("attachments", 5), requestPermission);

// ── Manual reassignment ────────────────────────────────────────────────────────
router.patch("/:id/reassign", protect, authorise("admin", "manager"), reassignTask);

module.exports = router;