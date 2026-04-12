const mongoose = require("mongoose");

const ProjectMemberSchema = mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project ID is required"],
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    role_in_project: {
      type: String,
      enum: ["manager", "developer", "designer", "tester", "viewer"],
      default: "developer",
      required: true,
    },
    joined_at: {
      type: Date,
      default: Date.now,            // auto-set when member is added
    },
    status: {
      type: String,
      enum: ["active", "removed", "left"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Prevent same user being added twice to the same project
ProjectMemberSchema.index({ project_id: 1, user_id: 1 }, { unique: true });

const ProjectMember = mongoose.model("ProjectMember", ProjectMemberSchema);
module.exports = ProjectMember;