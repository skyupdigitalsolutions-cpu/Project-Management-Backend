/**
 * routes/Taskroutes.js  — UPDATED
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs original:
 *  1. Added PATCH /:id/status   — dedicated status update
 *  2. Added POST  /:id/subtasks — add subtask to task
 *  3. Added PATCH /:id/subtasks/:subtaskId — update subtask
 *  4. Added DELETE /:id/subtasks/:subtaskId — delete subtask
 * All original routes are preserved.
 */

const express = require('express');
const router  = express.Router();

const {
  createTask,
  getAllTasks,
  getTaskById,
  updateTask,
  updateTaskStatus,
  deleteTask,
  bulkUpdateStatus,
  logDelay,
  updateProgress,
  handlePermission,
  requestPermission,
  reassignTask,
  getTaskStats,
  getWorkloadOverview,
  addSubtask,
  updateSubtask,
  deleteSubtask,
} = require('../controllers/taskController');

const { protect, authorise } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// ── Utility / collection routes ───────────────────────────────────────────────
router.get( '/stats',       protect,                              getTaskStats);
router.get( '/workload',    protect, authorise('admin', 'manager'), getWorkloadOverview);
router.post('/bulk-status', protect, authorise('admin', 'manager'), bulkUpdateStatus);

// ── Main CRUD ─────────────────────────────────────────────────────────────────
router.post('/',    protect, authorise('admin', 'manager'), createTask);
router.get( '/',    protect,                                getAllTasks);
router.get( '/:id', protect,                                getTaskById);
router.patch('/:id', protect,                               updateTask);
router.delete('/:id', protect, authorise('admin', 'manager'), deleteTask);

// ── Dedicated status update ────────────────────────────────────────────────────
router.patch('/:id/status', protect, updateTaskStatus);          // NEW

// ── Subtask management ─────────────────────────────────────────────────────────
router.post(  '/:id/subtasks',              protect, authorise('admin', 'manager'), addSubtask);    // NEW
router.patch( '/:id/subtasks/:subtaskId',   protect, authorise('admin', 'manager'), updateSubtask); // NEW
router.delete('/:id/subtasks/:subtaskId',   protect, authorise('admin', 'manager'), deleteSubtask); // NEW

// ── Progress tracking ──────────────────────────────────────────────────────────
router.patch('/:id/progress', protect, updateProgress);

// ── Delay logging ──────────────────────────────────────────────────────────────
router.post('/:id/delay', protect, logDelay);

// ── Permission: Admin grants or denies ─────────────────────────────────────────
router.patch('/:id/permission', protect, authorise('admin'), handlePermission);

// ── Permission: Employee requests permission on a blocked task ─────────────────
router.post('/:id/request-permission', protect, upload.array('attachments', 5), requestPermission);

// ── Manual reassignment ────────────────────────────────────────────────────────
router.patch('/:id/reassign', protect, authorise('admin', 'manager'), reassignTask);

module.exports = router;
