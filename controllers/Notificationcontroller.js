const mongoose = require("mongoose");
const Notification = require("../models/notification");

// ─── Helpers ────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
};

// ─── GET MY NOTIFICATIONS ────────────────────────────────────────────────────

/**
 * GET /notifications
 * Returns the calling user's notifications.
 * Query: ?is_read=true|false &type= &page= &limit=
 */
const getMyNotifications = async (req, res) => {
  try {
    const { is_read, type, page = 1, limit = 20 } = req.query;

    const filter = { user_id: req.user._id };
    if (is_read !== undefined) filter.is_read = is_read === "true";
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unread_count] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user_id: req.user._id, is_read: false }),
    ]);

    return res.status(200).json({
      success: true,
      total,
      unread_count,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: notifications,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET UNREAD COUNT ─────────────────────────────────────────────────────────

/**
 * GET /notifications/unread-count
 * Lightweight endpoint for the red badge in the UI.
 */
const getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ user_id: req.user._id, is_read: false });
    return res.status(200).json({ success: true, unread_count: count });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── MARK ONE AS READ ────────────────────────────────────────────────────────

/**
 * PATCH /notifications/:id/read
 * Marks a single notification as read.
 * Users can only mark their own notifications.
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, user_id: req.user._id },
      { $set: { is_read: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── MARK ALL AS READ ────────────────────────────────────────────────────────

/**
 * PATCH /notifications/mark-all-read
 * Marks all of the calling user's unread notifications as read.
 */
const markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user_id: req.user._id, is_read: false },
      { $set: { is_read: true } }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notification(s) marked as read`,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── MARK SPECIFIC AS READ (Bulk) ────────────────────────────────────────────

/**
 * PATCH /notifications/mark-read
 * Marks a specific set of notification IDs as read.
 * Body: { ids: [...] }
 */
const markManyAsRead = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
    }
    if (!ids.every(isValidObjectId)) {
      return res.status(400).json({ success: false, message: "One or more invalid notification IDs" });
    }

    const result = await Notification.updateMany(
      { _id: { $in: ids }, user_id: req.user._id },
      { $set: { is_read: true } }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notification(s) marked as read`,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── DELETE ONE ──────────────────────────────────────────────────────────────

/**
 * DELETE /notifications/:id
 * Users can delete their own notifications.
 */
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const notification = await Notification.findOneAndDelete({ _id: id, user_id: req.user._id });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── CLEAR ALL ───────────────────────────────────────────────────────────────

/**
 * DELETE /notifications/clear-all
 * Deletes ALL notifications for the calling user (read and unread).
 */
const clearAllNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({ user_id: req.user._id });

    return res.status(200).json({
      success: true,
      message: `${result.deletedCount} notification(s) cleared`,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── SEND NOTIFICATION (Internal helper + Admin broadcast) ───────────────────

/**
 * POST /notifications/send
 * Admin only — manually sends a notification to one or more users.
 * Body: { user_ids: [...], message, type, ref_id, ref_type }
 *
 * Also exported as a utility function for use in other controllers.
 */
const sendNotification = async (req, res) => {
  try {
    const { user_ids, message, type, ref_id, ref_type } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ success: false, message: "user_ids must be a non-empty array" });
    }
    if (!message || !type) {
      return res.status(400).json({ success: false, message: "message and type are required" });
    }

    const docs = user_ids.map((user_id) => ({
      user_id,
      sender_id: req.user._id,
      message,
      type,
      ref_id: ref_id || null,
      ref_type: ref_type || null,
    }));

    await Notification.insertMany(docs);

    return res.status(201).json({ success: true, message: `Notification sent to ${user_ids.length} user(s)` });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── REPLY TO NOTIFICATION ───────────────────────────────────────────────────

/**
 * PATCH /notifications/:id/reply
 * Admin and Manager only — add a reply to a notification.
 * Body: { reply }
 */
const replyToNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { reply } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }
    if (!reply || !reply.trim()) {
      return res.status(400).json({ success: false, message: "Reply message is required" });
    }

    const notification = await Notification.findByIdAndUpdate(
      id,
      {
        $set: {
          reply: reply.trim(),
          replied_by: req.user._id,
          replied_at: new Date(),
          is_read: true,
        },
      },
      { new: true }
    ).populate("replied_by", "name role");

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Utility — call from other controllers without going through HTTP.
 * Usage: await createNotification({ user_id, message, type, ref_id, ref_type })
 */
const createNotification = async ({ user_id, message, type, ref_id = null, ref_type = null }) => {
  try {
    await Notification.create({ user_id, message, type, ref_id, ref_type });
  } catch (error) {
    console.error("Notification creation failed:", error.message);
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markManyAsRead,
  deleteNotification,
  clearAllNotifications,
  sendNotification,
  replyToNotification,
  createNotification,   // utility for internal use
};