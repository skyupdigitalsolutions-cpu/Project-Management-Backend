const express = require("express");
const router = express.Router();

const { getMyProjects } = require("../controllers/Projectmembercontroller");
const { protect } = require("../middleware/authMiddleware");

// GET  /api/v1/members/my-projects   — Protected: all active projects the calling user belongs to
router.get("/my-projects", protect, getMyProjects);

module.exports = router;
