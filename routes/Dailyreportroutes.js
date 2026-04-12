const express = require("express");
const router = express.Router();

const {
  submitReport,
  getMyReports,
  getTodayReport,
  getAllReports,
  getUserReports,
  deleteReport,
} = require("../controllers/Dailyreportcontroller");

const { protect, authorise } = require("../middleware/authMiddleware");

// Static paths must be declared before /:id to avoid route conflicts

// Employee: submit / update today's report
router.post("/", protect, submitReport);

// Employee: fetch own today's report
router.get("/today", protect, getTodayReport);

// Employee: own report history (?from &to &page &limit)
router.get("/my", protect, getMyReports);

// Admin/Manager: reports for a specific employee
router.get("/user/:user_id", protect, authorise("admin", "manager"), getUserReports);

// Admin/Manager: all reports (?user_id &from &to &page &limit)
router.get("/", protect, authorise("admin", "manager"), getAllReports);

// Employee (own) or Admin: delete a report
router.delete("/:id", protect, deleteReport);

module.exports = router;
