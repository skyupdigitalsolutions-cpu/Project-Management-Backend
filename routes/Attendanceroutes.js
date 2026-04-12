const express = require("express");
const router = express.Router();

const {
  clockIn,
  clockOut,
  getTodayStatus,
  getMyAttendance,
  getUserAttendance,
  getAllAttendance,
  updateAttendanceRecord,
  markAbsent,
  getMonthlySummary,
} = require("../controllers/Attendancecontroller");
const { protect, authorise } = require("../middleware/authMiddleware");

// POST   /api/v1/attendance/clock-in              — Employee: clock in for today
// PATCH  /api/v1/attendance/clock-out             — Employee: clock out for today
// GET    /api/v1/attendance/today                 — Employee: get own today's record
// GET    /api/v1/attendance/my                    — Employee: get own history (?from &to &page &limit)
// POST   /api/v1/attendance/mark-absent           — Admin/Manager: bulk mark users absent
// GET    /api/v1/attendance/summary/:user_id      — Admin/Manager (or own): monthly summary (?month=YYYY-MM)
// GET    /api/v1/attendance/user/:user_id         — Admin/Manager: view any user's history
// GET    /api/v1/attendance                       — Admin/Manager: full log (?date &status &page &limit)
// PATCH  /api/v1/attendance/:id                   — Admin only: manually correct a record

// ⚠️Static paths (clock-in, clock-out, today, my, mark-absent, summary) must come
//     before parameterised paths (/:id) to prevent route conflicts
router.post("/clock-in",              protect, clockIn);
router.patch("/clock-out",            protect, clockOut);
router.get("/today",                  protect, getTodayStatus);
router.get("/my",                     protect, getMyAttendance);
router.post("/mark-absent",           protect, authorise("admin", "manager"), markAbsent);
router.get("/summary/:user_id",       protect, getMonthlySummary);
router.get("/user/:user_id",          protect, authorise("admin", "manager"), getUserAttendance);
router.get("/",                       protect, authorise("admin", "manager"), getAllAttendance);
router.patch("/:id",                  protect, authorise("admin"), updateAttendanceRecord);

module.exports = router;