const mongoose = require("mongoose");

const AssignmentMemberSchema = mongoose.Schema(
  {
    assignment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assignment",
      required: [true, "Assignment ID is required"],
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    role_in_assignment: {
      type: String,
      default: "member",
      trim: true,
    },
    allocated_hours: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent same user being added twice to the same assignment
AssignmentMemberSchema.index({ assignment_id: 1, user_id: 1 }, { unique: true });

const AssignmentMember = mongoose.model("AssignmentMember", AssignmentMemberSchema);
module.exports = AssignmentMember;
