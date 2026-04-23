const express = require("express");
const router = express.Router();

const { getAllUsers, getUserById, updateUser, deleteUser, updateRole, getUserStats } = require("../controllers/userController");
const { protect, authorise } = require("../middleware/authMiddleware");


router.get("/stats",        protect, authorise("admin"), getUserStats);
router.get("/",             protect, authorise("admin", "manager"), getAllUsers);
router.get("/:id",          protect, getUserById);
router.patch("/:id/role",   protect, authorise("admin"), updateRole);
router.patch("/:id",        protect, updateUser);
router.delete("/:id",       protect, authorise("admin"), deleteUser);

module.exports = router;
