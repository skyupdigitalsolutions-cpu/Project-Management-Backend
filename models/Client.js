const mongoose = require("mongoose");

const ClientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Client name is required"],
      trim: true,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    address: {
      type: String,
      default: null,
      trim: true,
    },
    gstNumber: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

ClientSchema.index({ email: 1 });
ClientSchema.index({ companyName: 1 });

const Client = mongoose.model("Client", ClientSchema);
module.exports = Client;
