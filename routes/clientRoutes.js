/**
 * routes/clientRoutes.js
 */

const express = require("express");
const router  = express.Router();

const { protect, authorise } = require("../middleware/authMiddleware");
const {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
} = require("../controllers/clientController");

// All routes require authentication
router.use(protect);

// List & create
router.get("/",    getAllClients);
router.post("/",   authorise("admin", "manager"), createClient);

// Single client
router.get("/:id",    getClientById);
router.put("/:id",    authorise("admin", "manager"), updateClient);
router.delete("/:id", authorise("admin"),            deleteClient);

module.exports = router;