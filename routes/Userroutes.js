/**
 * routes/userRoutes.js
 *
 * Route order matters — specific sub-resource routes (/stats, /:id/profile,
 * /:id/documents, /:id/role, /:id/designation) MUST be declared before the
 * generic /:id route or Express matches /:id first and swallows them.
 */

const express = require('express');
const router  = express.Router();

const {
  getAllUsers,
  getUserById,
  updateUser,
  updateDesignation,
  getUserDocuments,
  uploadUserDocuments,
  deleteUser,
  updateRole,
  getUserStats,
} = require('../controllers/userController');

const { protect, authorise }      = require('../middleware/authMiddleware');
const { uploadUserDocs,
        uploadDesignationDoc }     = require('../middleware/uploadMiddleware');

// ── Stats — no :id param, declare first ──────────────────────────────────────
router.get('/stats', protect, authorise('admin'), getUserStats);

// ── Collection ────────────────────────────────────────────────────────────────
router.get('/', protect, authorise('admin', 'manager'), getAllUsers);

// ── Sub-resource routes — before /:id ────────────────────────────────────────

// Profile alias — MyProfilePanel calls GET /api/users/:id/profile
router.get('/:id/profile', protect, getUserById);

// Documents
router.get( '/:id/documents', protect, getUserDocuments);
router.post('/:id/documents', protect, uploadUserDocs, uploadUserDocuments);

// Role
router.patch('/:id/role', protect, authorise('admin'), updateRole);

// Designation — uploadDesignationDoc parses the optional supportingDoc file
// and sets req.file before updateDesignation runs
router.patch(
  '/:id/designation',
  protect,
  authorise('admin', 'manager'),
  uploadDesignationDoc,
  updateDesignation,
);

// ── Generic user CRUD — must come last ───────────────────────────────────────
router.get(   '/:id', protect, getUserById);
router.patch( '/:id', protect, updateUser);
router.delete('/:id', protect, authorise('admin'), deleteUser);

module.exports = router;