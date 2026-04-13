const mongoose = require("mongoose");
const Leave = require("../models/leave");
const User = require("../models/users");

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res
    .status(statusCode)
    .json({ success: false, message: error.message || "Internal server error" });
};

// ─── APPLY FOR LEAVE ─────────────────────────────────────────────────────────

/**
 * POST /leaves
 * Any authenticated user applies for leave.
 * Body: { leave_type, from_date, to_date, days, reason, is_urgent?,
 *         contact_during_leave?, handover_notes? }
 */
const applyLeave = async (req, res) => {
  try {
    const {
      leave_type,
      from_date,
      to_date,
      days,
      reason,
      is_urgent,
      contact_during_leave,
      handover_notes,
    } = req.body;

    // Basic validation
    if (!leave_type || !from_date || !to_date || !days || !reason) {
      return res.status(400).json({
        success: false,
        message: "leave_type, from_date, to_date, days, and reason are required",
      });
    }

    const from = new Date(from_date);
    const to = new Date(to_date);

    if (isNaN(from) || isNaN(to)) {
      return res.status(400).json({ success: false, message: "Invalid date format" });
    }
    if (to < from) {
      return res
        .status(400)
        .json({ success: false, message: "to_date must be on or after from_date" });
    }
    if (reason.trim().length < 20) {
      return res
        .status(400)
        .json({ success: false, message: "Reason must be at least 20 characters" });
    }

    // Check for overlapping leave (same user, overlapping dates, not rejected)
    const overlap = await Leave.findOne({
      user_id: req.user._id,
      status: { $ne: "rejected" },
      from_date: { $lte: to },
      to_date: { $gte: from },
    });

    if (overlap) {
      return res.status(409).json({
        success: false,
        message: "You already have a leave request overlapping these dates",
      });
    }

    const leave = await Leave.create({
      user_id: req.user._id,
      leave_type,
      from_date: from,
      to_date: to,
      days: Number(days),
      reason: reason.trim(),
      is_urgent: Boolean(is_urgent),
      contact_during_leave: contact_during_leave || null,
      handover_notes: handover_notes || null,
    });

    await leave.populate("user_id", "name email department designation role");

    return res.status(201).json({
      success: true,
      message: "Leave application submitted successfully",
      data: leave,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── GET MY LEAVES ───────────────────────────────────────────────────────────

/**
 * GET /leaves/my
 * Returns the calling user's own leave requests.
 * Query: ?status= &page= &limit=
 */
const getMyLeaves = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = { user_id: req.user._id };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate("user_id", "name email department designation role")
        .populate("reviewed_by", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Leave.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: leaves,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET ALL LEAVES (Admin / Manager) ────────────────────────────────────────

/**
 * GET /leaves
 * Admin/Manager — full list with filters.
 * Query: ?status= &role= &user_id= &page= &limit=
 */
const getAllLeaves = async (req, res) => {
  try {
    const { status, role, user_id, page = 1, limit = 20 } = req.query;

    // Build user filter if role filter given
    let userIds = null;
    if (role) {
      const users = await User.find({ role }).select("_id");
      userIds = users.map((u) => u._id);
    }

    const filter = {};
    if (status) filter.status = status;
    if (user_id && isValidObjectId(user_id)) filter.user_id = user_id;
    if (userIds) filter.user_id = { $in: userIds };

    const skip = (Number(page) - 1) * Number(limit);

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate("user_id", "name email department designation role")
        .populate("reviewed_by", "name")
        .sort({ is_urgent: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Leave.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: leaves,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET SINGLE LEAVE ────────────────────────────────────────────────────────

/**
 * GET /leaves/:id
 * Admin/Manager sees any; employee sees own only.
 */
const getLeaveById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid leave ID" });
    }

    const leave = await Leave.findById(id)
      .populate("user_id", "name email department designation role")
      .populate("reviewed_by", "name");

    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    // Employees can only view their own
    if (
      req.user.role === "employee" &&
      leave.user_id._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ success: false, message: "Not authorised" });
    }

    return res.status(200).json({ success: true, data: leave });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE LEAVE STATUS (Admin / Manager) ───────────────────────────────────

/**
 * PATCH /leaves/:id
 * Admin/Manager — approve or reject a leave request.
 * Body: { status: "approved" | "rejected", admin_note?: string }
 *
 * Side-effect: updates the user's status to "on-leave" when approved,
 * and back to "active" when rejected or when an approved leave is later rejected.
 */
const updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, admin_note } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid leave ID" });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const leave = await Leave.findById(id).populate("user_id", "name email status");

    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    if (leave.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Leave is already ${leave.status}`,
      });
    }

    leave.status = status;
    leave.admin_note = admin_note?.trim() || null;
    leave.reviewed_by = req.user._id;
    leave.reviewed_at = new Date();
    await leave.save();

    // Update user status for approved leaves
    if (status === "approved") {
      await User.findByIdAndUpdate(leave.user_id._id, { status: "on-leave" });
    }

    await leave.populate("user_id", "name email department designation role");
    await leave.populate("reviewed_by", "name");

    return res.status(200).json({
      success: true,
      message: `Leave ${status} successfully`,
      data: leave,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── DELETE / CANCEL LEAVE ────────────────────────────────────────────────────

/**
 * DELETE /leaves/:id
 * Employee can cancel their own pending leave.
 * Admin can cancel any leave.
 */
const cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid leave ID" });
    }

    const leave = await Leave.findById(id);

    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave request not found" });
    }

    // Employees can only cancel their own pending leaves
    if (req.user.role === "employee") {
      if (leave.user_id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Not authorised" });
      }
      if (leave.status !== "pending") {
        return res
          .status(400)
          .json({ success: false, message: "Only pending leaves can be cancelled" });
      }
    }

    await leave.deleteOne();

    return res.status(200).json({ success: true, message: "Leave request cancelled" });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  getLeaveById,
  updateLeaveStatus,
  cancelLeave,
};
