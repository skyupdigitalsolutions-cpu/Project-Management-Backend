const express = require("express");
const router = express.Router();

const authRoutes         = require("./Authroutes");
const userRoutes         = require("./Userroutes");
const attendanceRoutes   = require("./Attendanceroutes");
const projectRoutes      = require("./Projectroutes");
const taskRoutes         = require("./Taskroutes");
const notificationRoutes = require("./Notificationroutes");
const memberRoutes       = require("./Memberroutes");
const assignmentRoutes   = require("./Assignmentroutes");
const meetingRoutes      = require("./Meetingroutes");
const Dailyreportroutes  = require("./Dailyreportroutes");
const leaveRoutes        = require("./Leaveroutes");

router.use("/auth",          authRoutes);
router.use("/users",         userRoutes);
router.use("/attendance",    attendanceRoutes);
router.use("/projects",      projectRoutes);
router.use("/tasks",         taskRoutes);
router.use("/notifications", notificationRoutes);
router.use("/members",       memberRoutes);
router.use("/assignments",   assignmentRoutes);
router.use("/meetings",      meetingRoutes);
router.use("/daily-reports", Dailyreportroutes);
router.use("/leaves",        leaveRoutes);

module.exports = router;
