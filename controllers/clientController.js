/**
 * controllers/clientController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * CRUD operations for Client.
 * Admin / manager only for create, update, delete.
 * All authenticated users can list clients.
 */

const mongoose = require("mongoose");
const Client   = require("../models/Client");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res
    .status(statusCode)
    .json({ success: false, message: error.message || "Internal server error" });
};

// ─── CREATE CLIENT ────────────────────────────────────────────────────────────

/**
 * POST /clients
 * Admin / Manager only
 */
const createClient = async (req, res) => {
  try {
    const { name, companyName, email, phone, address, gstNumber, notes } = req.body;

    if (!name || !companyName || !email) {
      return res.status(400).json({
        success: false,
        message: "name, companyName, and email are required",
      });
    }

    // Check duplicate email
    const existing = await Client.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A client with this email already exists",
      });
    }

    const client = await Client.create({
      name,
      companyName,
      email,
      phone:     phone     || null,
      address:   address   || null,
      gstNumber: gstNumber || null,
      notes:     notes     || null,
    });

    return res.status(201).json({ success: true, data: client });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Email already in use" });
    }
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── LIST CLIENTS ─────────────────────────────────────────────────────────────

/**
 * GET /clients
 * All authenticated users
 * Query params: search, page, limit, isActive
 */
const getAllClients = async (req, res) => {
  try {
    const { search, page = 1, limit = 20, isActive } = req.query;

    const filter = {};

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    if (search) {
      filter.$or = [
        { name:        { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { email:       { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Client.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      data: clients,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET CLIENT BY ID ─────────────────────────────────────────────────────────

/**
 * GET /clients/:id
 */
const getClientById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    return res.status(200).json({ success: true, data: client });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE CLIENT ────────────────────────────────────────────────────────────

/**
 * PUT /clients/:id
 * Admin / Manager only
 */
const updateClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const allowedFields = ["name", "companyName", "email", "phone", "address", "gstNumber", "notes", "isActive"];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields provided for update" });
    }

    // If email is being changed, check for duplicate
    if (updates.email) {
      const conflict = await Client.findOne({
        email: updates.email.toLowerCase().trim(),
        _id: { $ne: id },
      });
      if (conflict) {
        return res.status(409).json({ success: false, message: "Email already in use by another client" });
      }
    }

    const client = await Client.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    return res.status(200).json({ success: true, data: client });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── DELETE CLIENT ────────────────────────────────────────────────────────────

/**
 * DELETE /clients/:id
 * Admin only — soft-delete by setting isActive = false
 */
const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const client = await Client.findByIdAndUpdate(
      id,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    return res.status(200).json({ success: true, message: "Client deactivated successfully" });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
};
