const express = require("express");
const router = express.Router();

const {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
  getProjectStats,
} = require("../controllers/Projectcontroller");

const {
  addMember,
  getMembers,
  updateMemberRole,
  removeMember,
  leaveProject,
} = require("../controllers/Projectmembercontroller");

const { protect, authorise } = require("../middleware/authMiddleware");

// ─── Project CRUD ─────────────────────────────────────────────────────────────
// GET    /api/v1/projects/stats                            — Admin/Manager: counts by status & priority
// POST   /api/v1/projects                                  — Admin/Manager: create a project
// GET    /api/v1/projects                                  — Protected: scoped by role
// GET    /api/v1/projects/:id                              — Protected: full detail with members & task summary
// PATCH  /api/v1/projects/:id                              — Admin/Manager: update project
// DELETE /api/v1/projects/:id                              — Admin only: delete project + cascade

// ─── Project Members (nested under /projects/:project_id/members) ─────────────
// POST   /api/v1/projects/:project_id/members              — Admin/Manager: add a member
// GET    /api/v1/projects/:project_id/members              — Protected: list members (?status &role_in_project)
// PATCH  /api/v1/projects/:project_id/members/leave        — Protected: leave the project yourself
// PATCH  /api/v1/projects/:project_id/members/:member_id   — Admin/Manager: update member role
// DELETE /api/v1/projects/:project_id/members/:member_id   — Admin/Manager: remove a member

// /stats before /:id, and /members/leave before /members/:member_id
router.get("/stats",    protect, authorise("admin", "manager"), getProjectStats);
router.post("/",        protect, authorise("admin", "manager"), createProject);
router.get("/",         protect, getAllProjects);
router.get("/:id",      protect, getProjectById);
router.patch("/:id",    protect, authorise("admin", "manager"), updateProject);
router.delete("/:id",   protect, authorise("admin"), deleteProject);

// Nested member routes
router.post("/:project_id/members",               protect, authorise("admin", "manager"), addMember);
router.get("/:project_id/members",                protect, getMembers);
router.patch("/:project_id/members/leave",        protect, leaveProject);
router.patch("/:project_id/members/:member_id",   protect, authorise("admin", "manager"), updateMemberRole);
router.delete("/:project_id/members/:member_id",  protect, authorise("admin", "manager"), removeMember);

module.exports = router;