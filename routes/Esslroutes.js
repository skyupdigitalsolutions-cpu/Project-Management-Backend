const express = require("express");
const router = express.Router();

const {
  admsHandshake,
  getRequest,
  admsReceiver,
  syncFromDevice,
  assignFingerprintId,
  getFingerprintMap,
} = require("../controllers/EsslController");

const { protect, authorise } = require("../middleware/authMiddleware");

// ─── ADMS Routes (called by the eSSL device — NO auth token) ─────────────────
// The device doesn't send JWT tokens, so these must be public.
// Security: Lock these down at the network/firewall level instead
// (only allow requests from the device's IP).

router.get("/iclock/cdata", admsHandshake);          // Device registration/handshake
router.get("/iclock/getrequest", getRequest);         // Device polling for commands
router.post("/iclock/cdata", admsReceiver);           // Device pushes attendance logs ← MAIN

// ─── Admin Routes (require authentication) ────────────────────────────────────

// Manually pull logs from device over TCP/IP
router.post("/sync", protect, authorise("admin"), syncFromDevice);

// Map fingerprint IDs to employees
router.patch("/assign-fingerprint", protect, authorise("admin"), assignFingerprintId);

// List all employees and their fingerprint IDs
router.get("/fingerprint-map", protect, authorise("admin", "manager"), getFingerprintMap);

module.exports = router;
