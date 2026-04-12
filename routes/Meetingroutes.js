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
const { protect, authorise } = require("../middleware/Authmiddleware");

// GET    /api/v1/meetings          — all roles (filtered by role in controller)
// POST   /api/v1/meetings          — admin/manager only
// GET    /api/v1/meetings/:id      — all roles
// PATCH  /api/v1/meetings/:id      — admin/manager only
// DELETE /api/v1/meetings/:id      — admin/manager only
// POST   /api/v1/meetings/:id/notify — admin/manager only: resend invite

router.get("/",    protect, getMeetings);
router.post("/",   protect, authorise("admin", "manager"), createMeeting);

router.get("/:id",            protect, getMeeting);
router.patch("/:id",          protect, authorise("admin", "manager"), updateMeeting);
router.delete("/:id",         protect, authorise("admin", "manager"), deleteMeeting);
router.post("/:id/notify",    protect, authorise("admin", "manager"), resendNotification);

module.exports = router;
