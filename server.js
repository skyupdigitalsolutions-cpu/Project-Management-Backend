const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

const routes = require("./routes/Index");

const app = express();

// ─── Security & Utility Middleware ───────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://projectmanagement-lemon.vercel.app/',        // allows any vercel subdomain
  ],
  credentials: true
}));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    environment: process.env.NODE_ENV || "development",
  });
});

// ─── Seed Admin (run once, then remove) ──────────────────────────────────────
app.get("/seed-admin", async (req, res) => {
  try {
    const bcrypt = require("bcryptjs");
    const User = require("./models/users");
    const existing = await User.findOne({ email: "admin@company.com" });
    if (existing) return res.json({ message: "Admin already exists" });
    const salt = await bcrypt.genSalt(10);
    const password = await bcrypt.hash("admin123", salt);
    await User.create({
      name: "Admin",
      email: "admin@company.com",
      password,
      role: "admin",
      status: "active"
    });
    res.json({ message: "✅ Admin created! Email: admin@company.com / Password: admin123" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use("/api", routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "Internal server error"
      : err.message || "Internal server error";
  res.status(statusCode).json({ success: false, message });
});

// ─── Database + Server Startup ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/project-management";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("Database connected!..");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err.message);
    process.exit(1);
  });