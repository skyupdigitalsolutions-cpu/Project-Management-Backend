const express = require("express");
const router = express.Router();

const {
  applyLeave,
  getMyLeaves,
  getAllLeaves,
  getLeaveById,
  updateLeaveStatus,
  cancelLeave,
} = require("../controllers/leaveController");

const { protect, authorise } = require("../middleware/authMiddleware");

router.get("/my",    protect, getMyLeaves);
router.get("/",      protect, authorise("admin", "manager"), getAllLeaves);
router.get("/:id",   protect, getLeaveById);
router.post("/",     protect, applyLeave);
router.patch("/:id", protect, authorise("admin", "manager"), updateLeaveStatus);
router.delete("/:id",protect, cancelLeave);

module.exports = router;
