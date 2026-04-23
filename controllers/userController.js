const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/users");

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
};



const getAllUsers = async (req, res) => {
  try {
    const { role, department, status, page = 1, limit = 20, search } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (department) filter.department = department;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
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
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: users,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET USER BY ID ──────────────────────────────────────────────────────────

/**
 * GET /users/:id
 * Any authenticated user can view; employees can only view themselves.
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    // Employees may only read their own profile
    if (req.user.role === "employee" && req.user._id.toString() !== id) {
      return res.status(403).json({ success: false, message: "Not authorised to view this profile" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE USER ─────────────────────────────────────────────────────────────

/**
 * PATCH /users/:id
 * Employees can only update their own non-sensitive fields.
 * Admins can update anything (except password — use /auth/change-password).
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const isOwn = req.user._id.toString() === id;
    const isAdminOrManager = ["admin", "manager"].includes(req.user.role);

    if (!isOwn && !isAdminOrManager) {
      return res.status(403).json({ success: false, message: "Not authorised to update this user" });
    }

    const updates = { ...req.body };

    // Strip fields employees cannot change
    if (!isAdminOrManager) {
      delete updates.role;
      delete updates.status;
      delete updates.department;
      delete updates.designation;
      delete updates.joining_date;
    }

    // Never allow password change through this route
    delete updates.password;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── DELETE USER ─────────────────────────────────────────────────────────────

/**
 * DELETE /users/:id
 * Admin only — soft-deletes by setting status to "inactive".
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    if (req.user._id.toString() === id) {
      return res.status(400).json({ success: false, message: "You cannot deactivate your own account" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { status: "inactive" } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, message: "User deactivated successfully" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE ROLE ─────────────────────────────────────────────────────────────

/**
 * PATCH /users/:id/role
 * Admin only — changes a user's system role.
 */
const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const validRoles = ["admin", "manager", "employee"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(", ")}` });
    }

    const user = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, message: `Role updated to '${role}'`, data: user });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET STATS ───────────────────────────────────────────────────────────────

/**
 * GET /users/stats
 * Admin only — returns counts grouped by role and status.
 */
const getUserStats = async (req, res) => {
  try {
    const [byRole, byStatus, byDepartment] = await Promise.all([
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: "$department", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    const toMap = (arr) => arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});

    return res.status(200).json({
      success: true,
      data: {
        by_role: toMap(byRole),
        by_status: toMap(byStatus),
        by_department: byDepartment,
        total: await User.countDocuments(),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = { getAllUsers, getUserById, updateUser, deleteUser, updateRole, getUserStats };