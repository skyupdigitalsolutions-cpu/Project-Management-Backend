const mongoose = require("mongoose");

const UserSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Please enter your name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Enter your Mail"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Please enter a password"],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["admin", "manager", "employee"],
      default: "employee",
    },
    department: {
      type: String,
      required: [true, "Mention the department"],
      trim: true,
    },
    designation: {
      type: String,
      required: [true, "Mention the designation"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "on-leave"],
      default: "active",
    },
    joining_date: {
      type: Date,
      default: Date.now,
    },
    dailyWorkingHours: {
      type: Number,
      default: 8,
      min: [1, "Daily working hours must be at least 1"],
      max: [24, "Daily working hours cannot exceed 24"],
    },

    // ─── eSSL Fingerprint Machine Integration ──────────────────────────────
    // This is the Employee ID enrolled on the fingerprint machine.
    // Must match exactly what the device stores (usually a number like "1", "2", etc.)
    fingerprint_id: {
      type: String,
      default: null,
      trim: true,
      sparse: true, // allows multiple null values in unique index
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
module.exports = User;
