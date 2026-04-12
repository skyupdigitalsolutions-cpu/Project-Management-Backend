const mongoose = require("mongoose");

const NotificationSchema = mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,               // who receives the notification
    },
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,                // who sent the notification (null = system)
    },
    message: {
      type: String,
      required: true,
      trim: true,                   // e.g. "You have been assigned a new task"
    },
    type: {
      type: String,
      enum: [
        "task_assigned",// a task was assigned to the user
        "task_updated",// task status/priority changed
        "task_completed",// task marked as done
        "project_assigned",// user added to a project
        "project_updated",// project details changed
        "member_added",// new member joined your project
        "member_removed",// member removed from project
        "deadline_reminder",// task/project due date is near
        "general",// any other notification
        "meeting_invite",// invited to a meeting
      ],
      required: true,
    },
    is_read: {
      type: Boolean,
      default: false,// false = unread (shows red dot)
    },
    ref_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,                // ID of the related document
    },
    ref_type: {
      type: String,
      enum: ["Task", "Project", "User", "ProjectMember", "Meeting", null],
      default: null,                // which model ref_id points to
    },
  },
  { timestamps: true }              // timestamps handles created_at
);

// Fetch unread notifications faster
NotificationSchema.index({ user_id: 1, is_read: 1 });

const Notification = mongoose.model("Notification", NotificationSchema);
module.exports = Notification;