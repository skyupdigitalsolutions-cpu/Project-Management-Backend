/**
 * controllers/emailController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles admin → employee email with optional file attachments.
 *
 * POST /api/email/send  (multipart/form-data)
 * Body fields:
 *   user_ids     — JSON string array of recipient user IDs
 *   subject      — email subject
 *   body         — plain-text or HTML body
 *   attachments  — zero or more files (from multer)
 *
 * Flow:
 *  1. Validate fields
 *  2. Look up recipient emails from DB
 *  3. Send email via nodemailer to each recipient
 *  4. Return success summary
 */

const nodemailer   = require('nodemailer');
const User         = require('../models/users');
const fs           = require('fs');

// ─── Transporter factory ──────────────────────────────────────────────────────

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error(
      'Email not configured. Set EMAIL_USER and EMAIL_PASS in your .env file. ' +
      'See .env.example for instructions.'
    );
  }
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// ─── Helper: clean up uploaded temp files ────────────────────────────────────

function cleanupFiles(files = []) {
  files.forEach(f => {
    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {}
  });
}

// ─── Controller ──────────────────────────────────────────────────────────────

const sendEmail = async (req, res) => {
  const uploadedFiles = req.files || [];

  try {
    // ── 1. Parse & validate ───────────────────────────────────────────────
    let user_ids;
    try {
      user_ids = JSON.parse(req.body.user_ids || '[]');
    } catch {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'user_ids must be a valid JSON array' });
    }

    const { subject, body } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'user_ids must be a non-empty array' });
    }
    if (!subject?.trim()) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'subject is required' });
    }
    if (!body?.trim()) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ success: false, message: 'body is required' });
    }

    // ── 2. Look up recipient emails ───────────────────────────────────────
    const recipients = await User.find({ _id: { $in: user_ids } }).select('_id name email');

    if (recipients.length === 0) {
      cleanupFiles(uploadedFiles);
      return res.status(404).json({ success: false, message: 'No valid recipients found' });
    }

    // ── 3. Build attachments array for nodemailer ─────────────────────────
    const attachments = uploadedFiles.map(f => ({
      filename: f.originalname,
      path:     f.path,
    }));

    // ── 4. Create transporter (throws if not configured) ──────────────────
    const transporter = createTransporter();

    const senderName  = req.user?.name  || 'Admin';
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    // HTML email template
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                 background: #f8fafc; margin: 0; padding: 20px; color: #334155; }
          .card { background: #ffffff; border-radius: 12px; padding: 32px; 
                  max-width: 600px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
          .brand { font-size: 18px; font-weight: 700; color: #6366f1; }
          .subject { font-size: 22px; font-weight: 600; color: #1e293b; margin: 0 0 8px; }
          .meta { font-size: 13px; color: #94a3b8; }
          .body { font-size: 15px; line-height: 1.7; white-space: pre-wrap; color: #475569; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0;
                    font-size: 12px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div class="brand">SkyUp Digital Solutions</div>
          </div>
          <h2 class="subject">${subject.trim()}</h2>
          <p class="meta">From: ${senderName}</p>
          <div class="body" style="margin-top:20px">${body.trim().replace(/\n/g, '<br>')}</div>
          <div class="footer">
            This message was sent via the Project Management System.<br>
            Please do not reply directly to this email.
          </div>
        </div>
      </body>
      </html>
    `;

    // ── 5. Send email to each recipient ───────────────────────────────────
    const emailResults = await Promise.allSettled(
      recipients.map(r =>
        transporter.sendMail({
          from:        `"${senderName}" <${senderEmail}>`,
          to:          r.email,
          subject:     subject.trim(),
          text:        body.trim(),
          html:        htmlBody,
          attachments,
        })
      )
    );

    const sent   = emailResults.filter(r => r.status === 'fulfilled').length;
    const failed = emailResults.filter(r => r.status === 'rejected').length;

    if (failed > 0) {
      const firstError = emailResults.find(r => r.status === 'rejected')?.reason?.message;
      console.warn(`[emailController] ${failed} email(s) failed to send:`, firstError);
    }

    // ── 7. Cleanup temp files ─────────────────────────────────────────────
    cleanupFiles(uploadedFiles);

    return res.status(200).json({
      success: true,
      message: `Email sent to ${sent} recipient(s)${failed > 0 ? ` (${failed} failed)` : ''}`,
      data: {
        sent,
        failed,
        recipients: recipients.map(r => ({ name: r.name, email: r.email })),
        attachments: attachments.length,
      },
    });

  } catch (error) {
    cleanupFiles(uploadedFiles);
    console.error('[emailController] Error:', error.message);

    // Friendly error for missing email config
    if (error.message.includes('Email not configured')) {
      return res.status(503).json({
        success: false,
        message: 'Email service is not configured on the server. Please contact your administrator.',
      });
    }

    return res.status(500).json({ success: false, message: error.message || 'Failed to send email' });
  }
};

module.exports = { sendEmail };
// ─── APPROVAL REQUEST (notification-based, no email) ─────────────────────────
// POST /api/email/send-approval-request
// Any employee can call this to send an in-app approval request notification
// to all admins and managers about a task or project.
// Body (multipart or JSON):
//   message   — employee's message (required, min 5 chars)
//   ref_type  — "Task" | "Project" (optional)
//   ref_id    — ObjectId of the referenced item (optional)
//   subject   — short subject line shown in notification (optional)

const sendApprovalRequest = async (req, res) => {
  try {
    const { message, ref_type, ref_id, subject } = req.body;

    if (!message || message.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Please provide a message (min 5 characters)' });
    }

    const mongoose = require('mongoose');
    const Notification = require('../models/notification');

    // Validate ref_id if provided
    const validRefTypes = ['Task', 'Project', 'User', 'ProjectMember', 'Meeting', 'Assignment'];
    const safeRefType = validRefTypes.includes(ref_type) ? ref_type : null;
    const safeRefId   = ref_id && mongoose.Types.ObjectId.isValid(ref_id) ? ref_id : null;

    // Collect optional attachment names
    const attachments = (req.files || []).map(f => f.originalname);
    const attachmentNote = attachments.length > 0
      ? ` [${attachments.length} file(s): ${attachments.join(', ')}]`
      : '';

    const subjectLine = subject ? `[${subject.trim().substring(0, 60)}] ` : '';
    const notifMessage = `📋 ${subjectLine}Approval request from ${req.user.name}: ${message.trim().substring(0, 150)}${attachmentNote}`;

    // Notify all admins and managers
    const recipients = await User.find({ role: { $in: ['admin', 'manager'] }, status: 'active' }).select('_id');

    if (recipients.length === 0) {
      return res.status(200).json({ success: true, message: 'No admins/managers found, but request recorded.' });
    }

    const notifDocs = recipients.map(u => ({
      user_id:   u._id,
      sender_id: req.user._id,
      message:   notifMessage,
      type:      'approval_requested',
      ref_id:    safeRefId,
      ref_type:  safeRefType,
    }));

    await Notification.insertMany(notifDocs);

    return res.status(200).json({
      success:  true,
      message:  'Approval request sent to admins and managers.',
      notified: recipients.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

module.exports.sendApprovalRequest = sendApprovalRequest;
