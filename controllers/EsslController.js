/**
 * EsslController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all eSSL / ZKTeco fingerprint machine integration.
 *
 * TWO METHODS SUPPORTED:
 *
 * 1. ADMS PUSH (Recommended — device sends data to your server automatically)
 *    The eSSL machine is configured with your server URL. It pushes attendance
 *    logs to POST /api/essl/adms every time someone punches in/out.
 *
 * 2. TCP PULL (Manual sync — your server connects to the device and pulls logs)
 *    Admin triggers POST /api/essl/sync with the device IP. Requires the
 *    `node-zklib` npm package (see README).
 *
 * SETUP STEPS:
 *   npm install node-zklib     ← only needed for TCP pull method
 *
 * HOW fingerprint_id MAPS TO employees:
 *   Each employee must have their fingerprint_id set in the User document.
 *   This is the same ID they were enrolled with on the device (e.g., "1", "42").
 *   Set it via PATCH /api/users/:id  { fingerprint_id: "5" }
 */

const Attendance = require("../models/attendance");
const User = require("../models/users");

// ─── Shared Helpers ──────────────────────────────────────────────────────────

const toMidnight = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const calcHours = (clockIn, clockOut) =>
  Math.round(((clockOut - clockIn) / (1000 * 60 * 60)) * 100) / 100;

const deriveStatus = (clockIn, clockOut = null) => {
  const totalMinutes =
    new Date(clockIn).getHours() * 60 + new Date(clockIn).getMinutes();
  if (clockOut) {
    const worked = calcHours(new Date(clockIn), new Date(clockOut));
    if (worked < 4) return "half-day";
  }
  if (totalMinutes > 9 * 60 + 15) return "late";
  return "present";
};

/**
 * Decode eSSL punch type code → human-readable string.
 * eSSL device sends a numeric type:
 *   0 = check-in, 1 = check-out, 2 = break-out, 3 = break-in, 4 = OT-in, 5 = OT-out
 */
const decodePunchType = (typeCode) => {
  const map = {
    "0": "check-in",
    "1": "check-out",
    "2": "break-out",
    "3": "break-in",
    "4": "overtime-in",
    "5": "overtime-out",
  };
  return map[String(typeCode)] || "check-in";
};

/**
 * Decode eSSL verify method code → human-readable string.
 *   1 = fingerprint, 3 = password, 11 = face, 15 = card
 */
const decodeVerifyMethod = (verifyCode) => {
  const map = { "1": "fingerprint", "3": "password", "11": "face", "15": "card" };
  return map[String(verifyCode)] || "fingerprint";
};

/**
 * Core function: given a set of raw punch events for one employee on one day,
 * upsert the Attendance document.
 *
 * Logic:
 *  - First check-in type punch  → clock_in
 *  - Last  check-out type punch → clock_out
 */
const upsertAttendanceFromPunches = async (userId, dateObj, punches, deviceSerial) => {
  const date = toMidnight(dateObj);

  // Sort punches chronologically
  punches.sort((a, b) => new Date(a.time) - new Date(b.time));

  // Find first clock-in and last clock-out
  const clockInPunch = punches.find((p) =>
    ["check-in", "overtime-in"].includes(p.type)
  );
  const clockOutPunch = [...punches]
    .reverse()
    .find((p) => ["check-out", "overtime-out"].includes(p.type));

  if (!clockInPunch) return null; // no valid clock-in, skip

  const clock_in = new Date(clockInPunch.time);
  const clock_out = clockOutPunch ? new Date(clockOutPunch.time) : null;
  const hours_worked = clock_out ? calcHours(clock_in, clock_out) : null;
  const status = deriveStatus(clock_in, clock_out);

  // Build raw_logs array from all punches
  const raw_logs = punches.map((p) => ({
    time: new Date(p.time),
    type: p.type,
    verify: p.verify,
  }));

  const record = await Attendance.findOneAndUpdate(
    { user_id: userId, date },
    {
      $set: {
        clock_in,
        clock_out,
        hours_worked,
        status,
        source: "fingerprint",
        device_serial: deviceSerial || null,
      },
      $addToSet: {
        raw_logs: { $each: raw_logs },
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  return record;
};

// ─── METHOD 1: ADMS PUSH RECEIVER ────────────────────────────────────────────

/**
 * GET /api/essl/adms
 * eSSL device calls this endpoint first to register/check-in with server.
 * The device sends: ?SN=SERIAL&options=all&pushver=2.0.2
 * We must respond with a specific format the device understands.
 */
const admsHandshake = async (req, res) => {
  try {
    const { SN } = req.query;
    console.log(`[eSSL] Device handshake — Serial: ${SN}`);

    // Respond with current server time so device syncs its clock
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    res.set("Content-Type", "text/plain");
    res.send(`GET OPTION FROM: ${SN}\nATTSTAMP\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog OpLog EnrollUser\nTimeZone=5.5\nRealtime=1\nEncrypt=0\nServerVer=2.4\nTableNameFix=0\nDate=${timestamp}\n`);
  } catch (err) {
    console.error("[eSSL] Handshake error:", err);
    res.status(500).send("ERROR");
  }
};

/**
 * GET /api/essl/getrequest
 * Device polls this endpoint waiting for commands from server.
 * Respond with "OK" when no commands are queued.
 */
const getRequest = (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send("OK");
};

/**
 * POST /api/essl/adms
 * Main endpoint — device pushes attendance logs here.
 *
 * Query: ?SN=SERIAL&table=ATTLOG&Stamp=XXXXX
 * Body (plain text, one line per punch):
 *   fingerprint_id\tYYYY-MM-DD HH:MM:SS\tpunch_type\tverify_method\t0\t0
 *
 * Example body:
 *   1	2024-06-15 09:02:11	0	1	0	0
 *   1	2024-06-15 18:30:44	1	1	0	0
 *   2	2024-06-15 09:15:00	0	1	0	0
 */
const admsReceiver = async (req, res) => {
  try {
    const { SN: deviceSerial, table } = req.query;

    // Only process attendance logs; ignore other tables (EnrollUser, OpLog, etc.)
    if (table !== "ATTLOG") {
      console.log(`[eSSL] Ignoring table: ${table} from device ${deviceSerial}`);
      res.set("Content-Type", "text/plain");
      return res.send("OK");
    }

    // The body comes as plain text from the device
    const rawBody =
      typeof req.body === "string" ? req.body : req.body?.toString?.() || "";

    if (!rawBody.trim()) {
      res.set("Content-Type", "text/plain");
      return res.send("OK");
    }

    console.log(`[eSSL] Received ATTLOG from device ${deviceSerial}:\n${rawBody}`);

    // Parse each line: fingerprint_id \t datetime \t punch_type \t verify \t ...
    const lines = rawBody.trim().split("\n").filter(Boolean);
    const punchMap = new Map(); // key: "fingerprint_id::YYYY-MM-DD" → [punches]

    for (const line of lines) {
      const parts = line.trim().split(/\t|\s{2,}/); // tab or double-space separated
      if (parts.length < 2) continue;

      const [fingerprintId, datetimeStr, typeCode = "0", verifyCode = "1"] = parts;
      const punchTime = new Date(datetimeStr);
      if (isNaN(punchTime)) continue;

      const dateKey = punchTime.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const mapKey = `${fingerprintId}::${dateKey}`;

      if (!punchMap.has(mapKey)) punchMap.set(mapKey, []);
      punchMap.get(mapKey).push({
        fingerprintId: String(fingerprintId).trim(),
        time: punchTime,
        type: decodePunchType(typeCode),
        verify: decodeVerifyMethod(verifyCode),
        dateKey,
      });
    }

    // Get all unique fingerprint IDs from the batch
    const fingerprintIds = [...new Set([...punchMap.keys()].map((k) => k.split("::")[0]))];

    // Lookup users by fingerprint_id
    const users = await User.find({ fingerprint_id: { $in: fingerprintIds } });
    const userByFpId = new Map(users.map((u) => [String(u.fingerprint_id), u]));

    const results = { saved: 0, skipped: 0, errors: [] };

    for (const [mapKey, punches] of punchMap) {
      const [fpId, dateStr] = mapKey.split("::");
      const user = userByFpId.get(fpId);

      if (!user) {
        console.warn(`[eSSL] No user found with fingerprint_id="${fpId}" — skipping`);
        results.skipped++;
        continue;
      }

      try {
        await upsertAttendanceFromPunches(user._id, new Date(dateStr), punches, deviceSerial);
        results.saved++;
        console.log(`[eSSL] Saved attendance for ${user.name} (fp:${fpId}) on ${dateStr}`);
      } catch (err) {
        results.errors.push({ fpId, dateStr, error: err.message });
        console.error(`[eSSL] Error saving for fp:${fpId} on ${dateStr}:`, err.message);
      }
    }

    console.log(`[eSSL] Batch complete — saved:${results.saved} skipped:${results.skipped} errors:${results.errors.length}`);

    // Device expects plain "OK" on success
    res.set("Content-Type", "text/plain");
    res.send("OK");
  } catch (err) {
    console.error("[eSSL] Fatal ADMS receiver error:", err);
    res.set("Content-Type", "text/plain");
    res.send("ERROR");
  }
};

// ─── METHOD 2: TCP PULL SYNC ─────────────────────────────────────────────────

/**
 * POST /api/essl/sync
 * Admin manually triggers a pull from the device via TCP.
 * Body: { ip: "192.168.1.100", port: 4370, device_serial: "optional" }
 *
 * Requires: npm install node-zklib
 */
const syncFromDevice = async (req, res) => {
  let ZKLib;
  try {
    ZKLib = require("node-zklib");
  } catch {
    return res.status(501).json({
      success: false,
      message: "TCP pull requires the node-zklib package. Run: npm install node-zklib",
    });
  }

  const { ip, port = 4370, device_serial } = req.body;

  if (!ip) {
    return res.status(400).json({ success: false, message: "Device IP is required" });
  }

  let zkInstance;
  try {
    zkInstance = new ZKLib(ip, port, 10000, 4000);
    await zkInstance.createSocket();

    console.log(`[eSSL] Connected to device at ${ip}:${port}`);

    // Pull all attendance records from device
    const { data: logs } = await zkInstance.getAttendances();

    if (!logs || logs.length === 0) {
      await zkInstance.disconnect();
      return res.status(200).json({ success: true, message: "No logs found on device", saved: 0 });
    }

    console.log(`[eSSL] Pulled ${logs.length} punch records from device`);

    // Group punches by fingerprint_id + date
    const punchMap = new Map();

    for (const log of logs) {
      // node-zklib returns: { deviceUserId, userSn, recordTime, type, inOutStatus }
      const fpId = String(log.deviceUserId);
      const punchTime = new Date(log.recordTime);
      const dateKey = punchTime.toISOString().slice(0, 10);
      const mapKey = `${fpId}::${dateKey}`;

      if (!punchMap.has(mapKey)) punchMap.set(mapKey, []);
      punchMap.get(mapKey).push({
        fingerprintId: fpId,
        time: punchTime,
        type: decodePunchType(log.inOutStatus),
        verify: "fingerprint",
        dateKey,
      });
    }

    await zkInstance.disconnect();

    // Lookup users
    const fingerprintIds = [...new Set([...punchMap.keys()].map((k) => k.split("::")[0]))];
    const users = await User.find({ fingerprint_id: { $in: fingerprintIds } });
    const userByFpId = new Map(users.map((u) => [String(u.fingerprint_id), u]));

    const results = { saved: 0, skipped: 0, errors: [] };

    for (const [mapKey, punches] of punchMap) {
      const [fpId, dateStr] = mapKey.split("::");
      const user = userByFpId.get(fpId);

      if (!user) {
        results.skipped++;
        continue;
      }

      try {
        await upsertAttendanceFromPunches(user._id, new Date(dateStr), punches, device_serial || ip);
        results.saved++;
      } catch (err) {
        results.errors.push({ fpId, dateStr, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Sync complete`,
      total_logs: logs.length,
      ...results,
    });
  } catch (err) {
    if (zkInstance) {
      try { await zkInstance.disconnect(); } catch {}
    }
    console.error("[eSSL] TCP sync error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ASSIGN FINGERPRINT ID TO USER ───────────────────────────────────────────

/**
 * PATCH /api/essl/assign-fingerprint
 * Admin maps a fingerprint_id (from the device) to a user.
 * Body: { user_id: "...", fingerprint_id: "5" }
 */
const assignFingerprintId = async (req, res) => {
  try {
    const { user_id, fingerprint_id } = req.body;

    if (!user_id || !fingerprint_id) {
      return res.status(400).json({ success: false, message: "user_id and fingerprint_id are required" });
    }

    // Check for duplicate fingerprint_id
    const existing = await User.findOne({
      fingerprint_id: String(fingerprint_id).trim(),
      _id: { $ne: user_id },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `fingerprint_id "${fingerprint_id}" is already assigned to ${existing.name}`,
      });
    }

    const user = await User.findByIdAndUpdate(
      user_id,
      { fingerprint_id: String(fingerprint_id).trim() },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: `Fingerprint ID "${fingerprint_id}" assigned to ${user.name}`,
      data: user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/essl/fingerprint-map
 * Admin — list all employees with their fingerprint IDs.
 */
const getFingerprintMap = async (req, res) => {
  try {
    const users = await User.find({}, "name email department designation fingerprint_id status");

    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  admsHandshake,
  getRequest,
  admsReceiver,
  syncFromDevice,
  assignFingerprintId,
  getFingerprintMap,
};
