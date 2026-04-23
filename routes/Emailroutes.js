/**
 * routes/Emailroutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/email/send  — Admin/Manager only
 *   Sends an email with optional file attachments to one or more employees.
 */

const express = require('express');
const router  = express.Router();

const { protect, authorise }  = require('../middleware/authMiddleware');
const { sendEmail, sendApprovalRequest } = require('../controllers/emailController');
const upload                  = require('../middleware/uploadMiddleware');

// Accept up to 5 attachments (field name: "attachments")
router.post(
  '/send',
  protect,
  authorise('admin', 'manager'),
  upload.array('attachments', 5),
  sendEmail
);

// POST /api/email/send-approval-request — Any authenticated employee
// Sends an in-app notification (NOT email) to all admins/managers
router.post(
  '/send-approval-request',
  protect,
  upload.array('attachments', 5),
  sendApprovalRequest
);

module.exports = router;