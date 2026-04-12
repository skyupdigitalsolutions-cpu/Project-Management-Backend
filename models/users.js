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
      unique: true, // no duplicate emails
      lowercase: true, // store as lowercase always
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Please enter a password"],
      minlength: 6,
      select: false, // won't return password in queries by default
    },
    phone: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["admin", "manager", "employee"], // controlled roles
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
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
module.exports = User;