const mongoose = require("mongoose");

const AssignmentSchema = mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project ID is required"],
    },
    department: {
      type: String,
      required: [true, "Department is required"],
      trim: true,
      // e.g. SEO, Web Development, PPC, Content Writing, Design, Analytics, Social Media
    },
    title: {
      type: String,
      required: [true, "Assignment title is required"],
      trim: true,
    },
    description: {
      type: String,
      default: null,
      trim: true,
    },
    start_date: {
      type: Date,
      required: [true, "Start date is required"],
    },
    end_date: {
      type: Date,
      required: [true, "End date is required"],
    },
    status: {
      type: String,
      enum: ["planning", "active", "completed", "on-hold", "cancelled"],
      default: "planning",
    },
    estimated_hours: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

AssignmentSchema.pre("save", function () {
  if (this.end_date <= this.start_date) {
    throw new Error("end_date must be after start_date");
  }
});

const Assignment = mongoose.model("Assignment", AssignmentSchema);
module.exports = Assignment;
