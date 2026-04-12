const mongoose = require("mongoose");
const Meeting  = require("../models/meeting");
const User     = require("../models/users");
const { createNotification } = require("./Notificationcontroller");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
};

const PLATFORM_LABEL = { zoom: "Zoom", google_meet: "Google Meet", other: "Meeting" };

// ─── CREATE MEETING ────────────--─────────────────────────────────────────────

/**
 * POST /meetings
 * Admin or Manager only.
 * Body: { title, description, platform, meeting_link, scheduled_at, duration_minutes, invitee_ids }
 *   invitee_ids = [] or omitted → broadcast to ALL active users
 */
const createMeeting = async (req, res) => {
  try {
    const {
      title, description, platform, meeting_link,
      scheduled_at, duration_minutes, invitee_ids,
    } = req.body;

    if (!title || !platform || !meeting_link || !scheduled_at) {
      return res.status(400).json({ success: false, message: "title, platform, meeting_link, and scheduled_at are required" });
    }

    // Determine invitees
    let invitees    = [];
    let isBroadcast = false;

    if (!invitee_ids || invitee_ids.length === 0) {
      // Broadcast — fetch all active users except the creator
      const allUsers = await User.find({ status: "active", _id: { $ne: req.user._id } }).select("_id");
      invitees    = allUsers.map((u) => u._id);
      isBroadcast = true;
    } else {
      invitees    = invitee_ids.filter(isValidObjectId);
      isBroadcast = false;
    }

    const meeting = await Meeting.create({
      title,
      description: description || "",
      platform,
      meeting_link,
      scheduled_at: new Date(scheduled_at),
      duration_minutes: duration_minutes || 60,
      created_by: req.user._id,
      invitees,
      is_broadcast: isBroadcast,
    });

    // Fire notifications to all invitees
    const platformLabel = PLATFORM_LABEL[platform] || "Meeting";
    const scheduledDate = new Date(scheduled_at).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short",
    });

    await Promise.all(
      invitees.map((uid) =>
        createNotification({
          user_id:  uid,
          message:  `📅 You've been invited to "${title}" on ${platformLabel} — ${scheduledDate}. Join: ${meeting_link}`,
          type:     "meeting_invite",
          ref_id:   meeting._id,
          ref_type: "Meeting",
        })
      )
    );

    const populated = await Meeting.findById(meeting._id)
      .populate("created_by", "name role")
      .populate("invitees", "name email department");
    return res.status(201).json({ success: true, data: populated });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET ALL MEETINGS (admin/manager view) ────────────────────────────────────

/**
 * GET /meetings
 * Admin/Manager: see all meetings they created.
 * Employee: see meetings they are invited to.
 * Query: ?status= &page= &limit=
 */
const getMeetings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let filter = {};

    if (req.user.role === "employee") {
      filter = { invitees: req.user._id };
    } else if (req.user.role === "manager") {
      // managers see meetings they created OR are invited to
      filter = { $or: [{ created_by: req.user._id }, { invitees: req.user._id }] };
    }
    // admin sees all

    if (status) filter.status = status;

    const [meetings, total] = await Promise.all([
      Meeting.find(filter)
        .sort({ scheduled_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("created_by", "name role")
        .populate("invitees", "name email department"),
      Meeting.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: meetings,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET SINGLE MEETING ───────────────────────────────────────────────────────

const getMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid meeting ID" });
    }

    const meeting = await Meeting.findById(id)
      .populate("created_by", "name role")
      .populate("invitees", "name email department");

    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    return res.status(200).json({ success: true, data: meeting });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE MEETING ───────────────────────────────────────────────────────────

/**
 * PATCH /meetings/:id
 * Admin/Manager only. Notifies invitees of changes.
 */
const updateMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid meeting ID" });
    }

    const allowed = ["title", "description", "platform", "meeting_link", "scheduled_at", "duration_minutes", "status"];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const meeting = await Meeting.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
      .populate("created_by", "name role")
      .populate("invitees", "name email department");

    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    // Notify invitees
    if (meeting.invitees.length > 0) {
      await Promise.all(
        meeting.invitees.map((u) =>
          createNotification({
            user_id:  u._id,
            message:  `🔄 Meeting "${meeting.title}" has been updated. Check the latest details.`,
            type:     "meeting_invite",
            ref_id:   meeting._id,
            ref_type: "Meeting",
          })
        )
      );
    }

    return res.status(200).json({ success: true, data: meeting });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── DELETE MEETING ───────────────────────────────────────────────────────────

const deleteMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid meeting ID" });
    }

    const meeting = await Meeting.findByIdAndDelete(id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    return res.status(200).json({ success: true, message: "Meeting deleted" });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── RESEND NOTIFICATION ──────────────────────────────────────────────────────

/**
 * POST /meetings/:id/notify
 * Resend meeting invite notification to all (or specific) invitees.
 * Body: { invitee_ids }  — optional, resends to all if omitted
 */
const resendNotification = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid meeting ID" });
    }

    const meeting = await Meeting.findById(id).populate("invitees", "_id name");
    if (!meeting) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    const { invitee_ids } = req.body;
    let targets = meeting.invitees.map((u) => u._id);

    if (invitee_ids && invitee_ids.length > 0) {
      targets = invitee_ids.filter(isValidObjectId);
    }

    const platformLabel = PLATFORM_LABEL[meeting.platform] || "Meeting";
    const scheduledDate = new Date(meeting.scheduled_at).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short",
    });

    await Promise.all(
      targets.map((uid) =>
        createNotification({
          user_id:  uid,
          message:  `🔔 Reminder: "${meeting.title}" on ${platformLabel} — ${scheduledDate}. Join: ${meeting.meeting_link}`,
          type:     "meeting_invite",
          ref_id:   meeting._id,
          ref_type: "Meeting",
        })
      )
    );

    return res.status(200).json({ success: true, message: `Reminder sent to ${targets.length} user(s)` });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createMeeting,
  getMeetings,
  getMeeting,
  updateMeeting,
  deleteMeeting,
  resendNotification,
};
