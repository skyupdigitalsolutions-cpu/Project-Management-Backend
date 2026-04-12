const mongoose = require("mongoose");

const MeetingSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Meeting title is required"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    platform: {
      type: String,
      enum: ["zoom", "google_meet", "other"],
      required: true,
    },
    meeting_link: {
      type: String,
      required: [true, "Meeting link is required"],
      trim: true,
    },
    scheduled_at: {
      type: Date,
      required: [true, "Scheduled date/time is required"],
    },
    duration_minutes: {
      type: Number,
      default: 60,
      min: 1,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Who is invited — empty array = all users
    invitees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // broadcast = true means everyone was invited
    is_broadcast: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["upcoming", "ongoing", "completed", "cancelled"],
      default: "upcoming",
    },
  },
  { timestamps: true }
);

MeetingSchema.index({ scheduled_at: -1 });
MeetingSchema.index({ created_by: 1 });

const Meeting = mongoose.model("Meeting", MeetingSchema);
module.exports = Meeting;
