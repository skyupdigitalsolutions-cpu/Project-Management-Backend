const mongoose = require("mongoose");

const ProjectSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Please enter project title"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Please enter project description"],
      trim: true,
    },
    manager_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Please assign a manager"],
    },

    // Single project_type string — matches all controller & service usage
    project_type: {
      type: String,
      enum: [
        "website", "mobile_app", "ecommerce", "api_service",
        "data_analytics", "design", "content", "seo", "marketing",
        "admin_dashboard", "ai_features", "other",
      ],
      default: "other",
    },

    // Multi-select project types array — used by frontend wizard & plan generation
    project_types: {
      type: [String],
      enum: [
        "website", "mobile_app", "ecommerce", "api_service",
        "data_analytics", "design", "content", "seo", "marketing",
        "admin_dashboard", "ai_features", "other",
      ],
      default: [],
    },

    complexity: {
      type: String,
      enum: ["small", "medium", "large"],
      default: "medium",
    },

    status: {
      type: String,
      enum: ["planning", "active", "on-hold", "completed", "cancelled"],
      default: "planning",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      required: true,
    },

    start_date: { type: Date, required: [true, "Please enter start date"] },
    end_date:   { type: Date, required: [true, "Please enter end date"] },
    completed_at: { type: Date, default: null },

    client_info: {
      clientName:   { type: String, default: null, trim: true },
      companyName:  { type: String, default: null, trim: true },
      email:        { type: String, default: null, trim: true },
      phone:        { type: String, default: null, trim: true },
      website:      { type: String, default: null, trim: true },
      address:      { type: String, default: null, trim: true },
      budget:       { type: String, default: null, trim: true },
      requirements: { type: String, default: null, trim: true },
      notes:        { type: String, default: null, trim: true },
    },

    plan_version: { type: Number, default: 1 },

    // Document-driven creation
    document_path:          { type: String, default: null, trim: true },
    document_text:          { type: String, default: null, trim: true },
    extracted_description:  { type: String, default: null, trim: true },
    extracted_deliverables: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

ProjectSchema.pre("save", async function () {
  if (this.end_date <= this.start_date) {
    throw new Error("end_date must be after start_date");
  }
});

const Project = mongoose.model("Project", ProjectSchema);
module.exports = Project;