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


router.post("/", protect, submitReport);


router.get("/today", protect, getTodayReport);


router.get("/my", protect, getMyReports);


router.get("/user/:user_id", protect, authorise("admin", "manager"), getUserReports);


router.get("/", protect, authorise("admin", "manager"), getAllReports);


router.delete("/:id", protect, deleteReport);

module.exports = router;
