const mongoose = require("mongoose");

const NotificationSchema = mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    message: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: [
        "task_assigned",
        "task_updated",
        "task_completed",
        "task_delayed",
        "task_reassigned",
        "task_blocked",
        "project_assigned",
        "project_updated",
        "member_added",
        "member_removed",
        "deadline_reminder",
        "permission_requested",
        "permission_granted",
        "permission_denied",
        "leave_cover_assigned",
        "auto_assign",
        "general",
        "meeting_invite",
      ],
      required: true,
    },
    is_read: { type: Boolean, default: false },
    ref_id:  { type: mongoose.Schema.Types.ObjectId, default: null },
    ref_type: {
      type: String,
      enum: ["Task", "Project", "User", "ProjectMember", "Meeting", null],
      default: null,
    },
    is_sent:         { type: Boolean, default: false },
    recipient_count: { type: Number, default: null },
  },
  { timestamps: true }
);

NotificationSchema.index({ user_id: 1, is_read: 1 });
NotificationSchema.index({ sender_id: 1, is_sent: 1 });

const Notification = mongoose.model("Notification", NotificationSchema);
module.exports = Notification;
