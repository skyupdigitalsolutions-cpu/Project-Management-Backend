const express = require("express");
const router  = express.Router();
const {
  createMeeting,
  getMeetings,
  getMeeting,
  updateMeeting,
  deleteMeeting,
  resendNotification,
} = require("../controllers/Meetingcontroller");
const { protect, authorise } = require("../middleware/authMiddleware");



router.get("/",    protect, getMeetings);
router.post("/",   protect, authorise("admin", "manager"), createMeeting);

router.get("/:id",            protect, getMeeting);
router.patch("/:id",          protect, authorise("admin", "manager"), updateMeeting);
router.delete("/:id",         protect, authorise("admin", "manager"), deleteMeeting);
router.post("/:id/notify",    protect, authorise("admin", "manager"), resendNotification);

module.exports = router;
