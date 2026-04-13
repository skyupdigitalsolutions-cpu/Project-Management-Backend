const express = require("express");
const router = express.Router();

const {
  getMyNotifications,
  getSentNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markManyAsRead,
  deleteNotification,
  clearAllNotifications,
  sendNotification,
  replyToNotification,
} = require("../controllers/Notificationcontroller");
const { protect, authorise } = require("../middleware/authMiddleware");

// ⚠️  All static paths must come before /:id
router.get("/unread-count",    protect, getUnreadCount);
router.get("/sent",            protect, authorise("admin", "manager"), getSentNotifications);
router.patch("/mark-all-read", protect, markAllAsRead);
router.patch("/mark-read",     protect, markManyAsRead);
router.delete("/clear-all",    protect, clearAllNotifications);
router.post("/send",           protect, authorise("admin", "manager"), sendNotification);
router.get("/",                protect, getMyNotifications);
router.patch("/:id/reply",     protect, authorise("admin", "manager"), replyToNotification);
router.patch("/:id/read",      protect, markAsRead);
router.delete("/:id",          protect, deleteNotification);

module.exports = router;
