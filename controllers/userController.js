/**
 * controllers/userController.js
 *
 * Fixes vs previous version:
 *  1. getUserById  — removed the broken .replace('/profile','') logic.
 *                    Express populates req.params.id with ONLY the id segment,
 *                    never with the trailing "/profile" suffix. The replace was
 *                    harmless but confusing — removed for clarity.
 *  2. updateDesignation — unchanged, correctly reads req.file for supportingDoc.
 *  3. uploadUserDocuments — uses multer req.files structure exclusively.
 *  4. All other handlers unchanged.
 */

const bcrypt   = require('bcryptjs');
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const User     = require('../models/users');

// ── Helpers ───────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error('[userController]', error);
  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal server error',
  });
};

function unlinkSilent(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

/**
 * normalizeDocuments
 * Converts the documents sub-object stored in the DB into the flat-array format
 * DocumentUploadPanel expects: [{ type, originalName, name, url, path }]
 */
function normalizeDocuments(user) {
  const docs   = user.documents || {};
  const result = [];

  for (const field of ['aadhaar', 'pan', 'resume', 'offerLetter']) {
    if (docs[field]) {
      result.push({
        type:         field,
        originalName: path.basename(docs[field]),
        name:         path.basename(docs[field]),
        url:          `/uploads/${path.basename(docs[field])}`,
        path:         docs[field],
      });
    }
  }

  if (user.salarySlip) {
    result.push({
      type:         'salarySlip',
      originalName: path.basename(user.salarySlip),
      name:         path.basename(user.salarySlip),
      url:          `/uploads/${path.basename(user.salarySlip)}`,
      path:         user.salarySlip,
    });
  }

  if (user.experienceCertificate) {
    result.push({
      type:         'experienceCertificate',
      originalName: path.basename(user.experienceCertificate),
      name:         path.basename(user.experienceCertificate),
      url:          `/uploads/${path.basename(user.experienceCertificate)}`,
      path:         user.experienceCertificate,
    });
  }

  if (Array.isArray(docs.certificates)) {
    docs.certificates.forEach((p) => {
      result.push({
        type:         'certificate',
        originalName: path.basename(p),
        name:         path.basename(p),
        url:          `/uploads/${path.basename(p)}`,
        path:         p,
      });
    });
  }

  return result;
}

// ── GET ALL USERS ─────────────────────────────────────────────────────────────

const getAllUsers = async (req, res) => {
  try {
    const { role, department, status, page = 1, limit = 20, search, isFresher } = req.query;

    const filter = {};
    if (role)       filter.role       = role;
    if (department) filter.department = department;
    if (status)     filter.status     = status;
    if (isFresher !== undefined && isFresher !== '')
      filter.isFresher = isFresher === 'true';
    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: 'i' } },
        { email:       { $regex: search, $options: 'i' } },
        { designation: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
      data:  users,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── GET USER BY ID ────────────────────────────────────────────────────────────
//
// Also serves GET /:id/profile (route alias in userRoutes.js).
// Express always gives req.params.id as just the id — no suffix to strip.

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    if (req.user.role === 'employee' && req.user._id.toString() !== id) {
      return res.status(403).json({ success: false, message: 'Not authorised to view this profile' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── UPDATE USER ───────────────────────────────────────────────────────────────

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const isOwn            = req.user._id.toString() === id;
    const isAdminOrManager = ['admin', 'manager'].includes(req.user.role);

    if (!isOwn && !isAdminOrManager) {
      return res.status(403).json({ success: false, message: 'Not authorised to update this user' });
    }

    const updates = { ...req.body };

    // Employees cannot change these fields through the profile-edit flow
    if (!isAdminOrManager) {
      delete updates.role;
      delete updates.status;
      delete updates.department;
      delete updates.designation;
      delete updates.joining_date;
      delete updates.isFresher;
      delete updates.previousCompany;
      delete updates.pfDetails;
    }

    // Fields that must never be patched directly
    delete updates.password;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.designationHistory;

    // Advisory warnings instead of hard-blocking (documents uploaded separately)
    const warnings = [];
    const isFresherValue = updates.isFresher;
    if (isFresherValue === false || isFresherValue === 'false') {
      const existing = await User.findById(id).select('salarySlip experienceCertificate previousCompany');
      if (!updates.previousCompany     && !existing?.previousCompany)     warnings.push('previousCompany is missing');
      if (!updates.salarySlip          && !existing?.salarySlip)          warnings.push('salarySlip document not yet uploaded');
      if (!updates.experienceCertificate && !existing?.experienceCertificate) warnings.push('experienceCertificate not yet uploaded');
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success:  true,
      data:     user,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ── UPDATE DESIGNATION ────────────────────────────────────────────────────────
//
// PATCH /users/:id/designation
// Body (multipart/form-data or JSON): { designation, note? }
// File (optional): supportingDoc  — set by uploadDesignationDoc middleware → req.file

const updateDesignation = async (req, res) => {
  try {
    const { id } = req.params;
    const { designation, note } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    if (!designation || !designation.trim()) {
      return res.status(400).json({ success: false, message: 'designation is required' });
    }

    // req.file populated by uploadDesignationDoc (multer single('supportingDoc'))
    const supportingDocPath = req.file ? req.file.path : null;

    const query = User.findByIdAndUpdate(
      id,
      { $set: { designation: designation.trim() } },
      { new: true, runValidators: true }
    );

    // Passed to the model pre-hook so it can build the history entry
    query._meta = {
      changedBy:     req.user._id,
      supportingDoc: supportingDocPath,
      note:          note?.trim() || null,
    };

    const user = await query.exec();

    if (!user) {
      unlinkSilent(supportingDocPath);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      message: `Designation updated to "${designation.trim()}"`,
      data:    user,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── GET USER DOCUMENTS ────────────────────────────────────────────────────────
//
// GET /users/:id/documents
// Returns documents in the flat-array format DocumentUploadPanel expects.

const getUserDocuments = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const isOwn            = req.user._id.toString() === id;
    const isAdminOrManager = ['admin', 'manager'].includes(req.user.role);

    if (!isOwn && !isAdminOrManager) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    const user = await User.findById(id).select('documents salarySlip experienceCertificate');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, data: normalizeDocuments(user) });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── UPLOAD USER DOCUMENTS ─────────────────────────────────────────────────────
//
// POST /users/:id/documents
// Processed by uploadUserDocs (multer fields()).
//
// req.files shape:
//   {
//     aadhaar:               [{ path, originalname, ... }],
//     pan:                   [{ ... }],
//     resume:                [{ ... }],
//     offerLetter:           [{ ... }],
//     salarySlip:            [{ ... }],
//     experienceCertificate: [{ ... }],
//     certificates:          [{ ... }, ...],
//   }

const uploadUserDocuments = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const isOwn            = req.user._id.toString() === id;
    const isAdminOrManager = ['admin', 'manager'].includes(req.user.role);

    if (!isOwn && !isAdminOrManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorised to upload documents for this user',
      });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const user = await User.findById(id);
    if (!user) {
      Object.values(req.files).flat().forEach((f) => unlinkSilent(f.path));
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const docUpdates    = {};
    const directUpdates = {};
    const files         = req.files;
    const getFile       = (field) => files[field]?.[0] ?? null;

    if (getFile('aadhaar')) {
      unlinkSilent(user.documents?.aadhaar);
      docUpdates['documents.aadhaar'] = getFile('aadhaar').path;
    }
    if (getFile('pan')) {
      unlinkSilent(user.documents?.pan);
      docUpdates['documents.pan'] = getFile('pan').path;
    }
    if (getFile('resume')) {
      unlinkSilent(user.documents?.resume);
      docUpdates['documents.resume'] = getFile('resume').path;
    }
    if (getFile('offerLetter')) {
      unlinkSilent(user.documents?.offerLetter);
      docUpdates['documents.offerLetter'] = getFile('offerLetter').path;
    }
    if (files['certificates']?.length) {
      docUpdates['documents.certificates'] = [
        ...(user.documents?.certificates ?? []),
        ...files['certificates'].map((f) => f.path),
      ];
    }
    if (getFile('salarySlip')) {
      unlinkSilent(user.salarySlip);
      directUpdates.salarySlip = getFile('salarySlip').path;
    }
    if (getFile('experienceCertificate')) {
      unlinkSilent(user.experienceCertificate);
      directUpdates.experienceCertificate = getFile('experienceCertificate').path;
    }

    const allUpdates = { ...docUpdates, ...directUpdates };

    if (Object.keys(allUpdates).length === 0) {
      return res.status(400).json({ success: false, message: 'No recognised file fields found' });
    }

    const updated = await User.findByIdAndUpdate(id, { $set: allUpdates }, { new: true });

    return res.status(200).json({
      success: true,
      message: 'Documents uploaded successfully',
      data:    normalizeDocuments(updated),
    });
  } catch (error) {
    if (req.files) Object.values(req.files).flat().forEach((f) => unlinkSilent(f.path));
    return handleError(res, error);
  }
};

// ── DELETE USER ───────────────────────────────────────────────────────────────

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    if (req.user._id.toString() === id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }

    const user = await User.findByIdAndUpdate(id, { $set: { status: 'inactive' } }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── UPDATE ROLE ───────────────────────────────────────────────────────────────

const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const validRoles = ['admin', 'manager', 'employee'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${validRoles.join(', ')}`,
      });
    }

    const user = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, message: `Role updated to '${role}'`, data: user });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── USER STATS ────────────────────────────────────────────────────────────────

const getUserStats = async (req, res) => {
  try {
    const [byRole, byStatus, byDepartment, total] = await Promise.all([
      User.aggregate([{ $group: { _id: '$role',       count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: '$status',     count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      User.countDocuments(),
    ]);

    const toMap = (arr) => arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

    return res.status(200).json({
      success: true,
      data: {
        by_role:       toMap(byRole),
        by_status:     toMap(byStatus),
        by_department: byDepartment,
        total,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  updateDesignation,
  getUserDocuments,
  uploadUserDocuments,
  deleteUser,
  updateRole,
  getUserStats,
};