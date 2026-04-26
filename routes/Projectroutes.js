/**
 * routes/Projectroutes.js  — UPDATED
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs original:
 *  1. GET /clients-list — returns active clients for the project-creation wizard
 *  2. POST /:projectId/import  — Excel task import for a specific project
 * All original routes preserved unchanged.
 */

const express = require('express');
const router  = express.Router();
const upload  = require('../middleware/uploadMiddleware');
const { uploadExcel } = require('../middleware/uploadMiddleware');

const {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
  getProjectStats,
  getProjectDocument,
  generateProjectPlan,
  uploadProjectDocument,
  getClientsForProject,
} = require('../controllers/Projectcontroller');

const {
  addMember,
  getMembers,
  updateMemberRole,
  removeMember,
  leaveProject,
} = require('../controllers/Projectmembercontroller');

const { importTasksFromExcelController } = require('../controllers/importController');
const { protect, authorise } = require('../middleware/authMiddleware');

// Utility routes (must come before /:id)
router.get('/stats',          protect, authorise('admin', 'manager'), getProjectStats);
router.get('/clients-list',   protect,                                getClientsForProject);
router.post('/generate-plan', protect, authorise('admin', 'manager'), generateProjectPlan);

// Main CRUD
router.post('/', protect, authorise('admin', 'manager'), upload.single('document'), createProject);
router.get('/',  protect, getAllProjects);

// Single project
router.get('/:id',    protect,                                getProjectById);
router.patch('/:id',  protect, authorise('admin', 'manager'), updateProject);
router.delete('/:id', protect, authorise('admin'),            deleteProject);

// Document management
router.get('/:id/document',   protect, getProjectDocument);
router.patch('/:id/document', protect, authorise('admin', 'manager'),
  upload.single('document'), uploadProjectDocument);

// Excel task import
router.post('/:projectId/import', protect, authorise('admin', 'manager'),
  uploadExcel, importTasksFromExcelController);

// Nested member routes
router.post('/:project_id/members',              protect, authorise('admin', 'manager'), addMember);
router.get('/:project_id/members',               protect,                               getMembers);
router.patch('/:project_id/members/leave',       protect,                               leaveProject);
router.patch('/:project_id/members/:member_id',  protect, authorise('admin', 'manager'), updateMemberRole);
router.delete('/:project_id/members/:member_id', protect, authorise('admin', 'manager'), removeMember);

module.exports = router;
