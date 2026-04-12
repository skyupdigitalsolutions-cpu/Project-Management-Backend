const express = require("express");
const router = express.Router();

const { register, login, getMe, changePassword } = require("../controllers/Authcontroller");
const { protect, authorise } = require("../middleware/authMiddleware");

// POST   /api/v1/auth/register       — Admin only: create a new user account
// POST   /api/v1/auth/login          — Public: authenticate and receive JWT
// GET    /api/v1/auth/me             — Protected: get own profile
// PATCH  /api/v1/auth/change-password — Protected: update own password

router.post("/register",         protect, authorise("admin"), register);
router.post("/login",            login);
router.get("/me",                protect, getMe);
router.patch("/change-password", protect, changePassword);

module.exports = router;