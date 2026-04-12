const express = require("express");
const router = express.Router();

const {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markManyAsRead,
  deleteNotification,
  clearAllNotifications,
  sendNotification,
  replyToNotification,
} = require("../controllers/Notificationcontroller");
const { protect, authorise } = require("../middleware/Authmiddleware");

// GET    /api/v1/notifications                  — Protected: own notifications (?is_read &type &page &limit)
// GET    /api/v1/notifications/unread-count     — Protected: badge count only
// PATCH  /api/v1/notifications/mark-all-read   — Protected: mark every unread notification as read
// PATCH  /api/v1/notifications/mark-read       — Protected: mark specific IDs as read (body: { ids })
// DELETE /api/v1/notifications/clear-all       — Protected: delete all own notifications
// POST   /api/v1/notifications/send            — Admin only: broadcast to one or more users
// PATCH  /api/v1/notifications/:id/reply       — Admin/Manager only: reply to a notification
// PATCH  /api/v1/notifications/:id/read        — Protected: mark single notification as read
// DELETE /api/v1/notifications/:id             — Protected: delete a single notification

// ⚠️  All static paths must come before /:id
router.get("/unread-count",    protect, getUnreadCount);
router.patch("/mark-all-read", protect, markAllAsRead);
router.patch("/mark-read",     protect, markManyAsRead);
router.delete("/clear-all",    protect, clearAllNotifications);
router.post("/send",           protect, authorise("admin", "manager"), sendNotification);
router.get("/",                protect, getMyNotifications);
router.patch("/:id/reply",     protect, authorise("admin", "manager"), replyToNotification);
router.patch("/:id/read",      protect, markAsRead);
router.delete("/:id",          protect, deleteNotification);

module.exports = router;