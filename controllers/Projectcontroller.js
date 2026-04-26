/**
 * controllers/projectController.js  — UPDATED
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs original:
 *  1. createProject  — accepts `client_id`, validates it, attaches to project
 *                       also triggers auto-task creation via taskService
 *  2. getAllProjects  — populates client_id
 *  3. getProjectById — populates client_id, always returns project_types as array
 *  4. getAllClients   — helper to list clients for the project-creation wizard
 *  5. All other functions unchanged
 */

const mongoose      = require('mongoose');
const Project       = require('../models/project');
const ProjectMember = require('../models/project_member');
const Task          = require('../models/tasks');
const Assignment       = require('../models/assignment');
const AssignmentMember = require('../models/assignment_member');
const Client        = require('../models/Client');
const path          = require('path');
const { parseProjectDocument }     = require('../services/documentParser');
const eventBus                     = require('../services/eventBus');
const { generateUnifiedProjectPlan } = require('../services/taskGenerationService');
const { autoCreateTasksForProject }  = require('../services/taskService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const handleError = (res, error, statusCode = 500) => {
  console.error(error);
  return res.status(statusCode).json({ success: false, message: error.message || 'Internal server error' });
};

// ─── LIST CLIENTS (for project-creation wizard) ───────────────────────────────

/**
 * GET /projects/clients
 * Returns active clients so the UI can render a dropdown.
 */
const getClientsForProject = async (req, res) => {
  try {
    const clients = await Client.find({ isActive: true })
      .select('name companyName email phone')
      .sort({ companyName: 1 });

    return res.status(200).json({ success: true, data: clients });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── CREATE PROJECT ───────────────────────────────────────────────────────────

const createProject = async (req, res) => {
  try {
    const {
      title, description, manager_id, status, priority,
      start_date, end_date, project_type, project_types, complexity,
      client_info, client_id,
    } = req.body;

    if (manager_id && !isValidObjectId(manager_id)) {
      return res.status(400).json({ success: false, message: 'Invalid manager_id' });
    }

    // Validate client_id if provided
    if (client_id) {
      if (!isValidObjectId(client_id)) {
        return res.status(400).json({ success: false, message: 'Invalid client_id' });
      }
      const clientExists = await Client.findById(client_id);
      if (!clientExists) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
    }

    let documentPath          = null;
    let documentText          = null;
    let extractedDescription  = description || null;
    let extractedDeliverables = [];
    let extractedTaskDrafts   = [];

    if (req.file) {
      documentPath = req.file.path;
      try {
        const parsed = await parseProjectDocument(req.file.path, title);
        documentText          = parsed.rawText;
        extractedDescription  = parsed.description  || description;
        extractedDeliverables = parsed.deliverables || [];
        extractedTaskDrafts   = parsed.tasks        || [];
      } catch (parseErr) {
        console.error('Document parsing failed:', parseErr.message);
      }
    }

    // Normalise project_types — always store as array
    let typesArray = [];
    if (Array.isArray(project_types) && project_types.length > 0) {
      typesArray = project_types;
    } else if (Array.isArray(req.body['project_types[]'])) {
      typesArray = req.body['project_types[]'];
    } else if (typeof req.body['project_types[]'] === 'string') {
      typesArray = [req.body['project_types[]']];
    } else if (project_type) {
      typesArray = [project_type];
    }

    const resolvedProjectType = typesArray[0] || project_type || 'other';

    const project = await Project.create({
      title,
      description:            extractedDescription || description,
      manager_id:             manager_id || req.user._id,
      client_id:              client_id  || null,
      status,
      priority,
      project_type:           resolvedProjectType,
      project_types:          typesArray,
      complexity:             complexity || 'medium',
      start_date,
      end_date,
      client_info:            client_info || {},
      document_path:          documentPath,
      document_text:          documentText,
      extracted_description:  extractedDescription,
      extracted_deliverables: extractedDeliverables,
    });

    await ProjectMember.create({
      project_id:      project._id,
      user_id:         project.manager_id,
      role_in_project: 'manager',
    });

    // Auto-create tasks based on projectType (non-blocking)
    autoCreateTasksForProject(project, req.user._id)
      .catch((err) => console.error('[taskService] autoCreateTasksForProject error:', err.message));

    // Emit event for existing auto-assign flow
    eventBus.emitAsync('project:created', {
      project,
      taskDrafts: extractedTaskDrafts,
      adminId:    req.user._id,
    }).catch((err) => console.error('[EVENT] project:created handler error:', err.message));

    return res.status(201).json({
      success: true,
      data:    project,
      extracted_tasks: extractedTaskDrafts,
      message: extractedTaskDrafts.length > 0
        ? `Project created. Auto-assigning ${extractedTaskDrafts.length} extracted task(s) in background.`
        : 'Project created. Auto-tasks are being generated in background.',
    });
  } catch (error) {
    if (error.name === 'ValidationError' || error.message.includes('end_date')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleError(res, error);
  }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────

const getAllProjects = async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 20, search, client_id } = req.query;
    const { role, _id: userId } = req.user;

    let filter = {};
    if (role === 'manager') {
      filter.manager_id = userId;
    } else if (role === 'employee') {
      const [memberships, taskProjectIds] = await Promise.all([
        ProjectMember.find({ user_id: userId, status: 'active' }).select('project_id'),
        Task.find({ assigned_to: userId }).distinct('project_id'),
      ]);
      const memberProjectIds = memberships.map((m) => m.project_id.toString());
      const taskProjIds      = taskProjectIds.map((id) => id.toString());
      const allProjectIds    = [...new Set([...memberProjectIds, ...taskProjIds])];
      filter._id = { $in: allProjectIds };
    }

    if (status)    filter.status    = status;
    if (priority)  filter.priority  = priority;
    if (client_id && isValidObjectId(client_id)) filter.client_id = client_id;
    if (search) {
      filter.$or = [
        { title:       { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('manager_id', 'name email designation')
        .populate('client_id', 'name companyName email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Project.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true, total,
      page:    Number(page),
      pages:   Math.ceil(total / Number(limit)),
      data:    projects,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────

const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID' });
    }

    const project = await Project.findById(id)
      .populate('manager_id', 'name email designation department')
      .populate('client_id',  'name companyName email phone address gstNumber');

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (req.user.role === 'employee') {
      const [isMember, hasTask] = await Promise.all([
        ProjectMember.exists({ project_id: id, user_id: req.user._id, status: 'active' }),
        Task.exists({ project_id: id, assigned_to: req.user._id }),
      ]);
      if (!isMember && !hasTask) {
        return res.status(403).json({ success: false, message: 'You are not a member of this project' });
      }
    }

    const [members, taskStats] = await Promise.all([
      ProjectMember.find({ project_id: id, status: 'active' })
        .populate('user_id', 'name email designation'),
      Task.aggregate([
        { $match: { project_id: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const taskSummary  = taskStats.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
    const projectObj   = project.toObject();
    const safeProjectTypes =
      Array.isArray(projectObj.project_types) && projectObj.project_types.length > 0
        ? projectObj.project_types
        : projectObj.project_type
          ? [projectObj.project_type]
          : [];

    return res.status(200).json({
      success: true,
      data: {
        ...projectObj,
        project_types: safeProjectTypes,
        members,
        task_summary:  taskSummary,
      },
    });
  } catch (error) {
    console.error('getProjectById error:', error);
    return handleError(res, error);
  }
};

// ─── GET DOCUMENT ─────────────────────────────────────────────────────────────

const getProjectDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const project = await Project.findById(id).select('document_path title');
    if (!project)
      return res.status(404).json({ success: false, message: 'Project not found' });
    if (!project.document_path)
      return res.status(404).json({ success: false, message: 'No document attached' });

    const ext      = path.extname(project.document_path);
    const filename = `${project.title.replace(/[^a-z0-9]/gi, '_')}${ext}`;
    res.download(project.document_path, filename);
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPDATE PROJECT ───────────────────────────────────────────────────────────

const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const project = await Project.findById(id);
    if (!project)
      return res.status(404).json({ success: false, message: 'Project not found' });

    const isAdmin   = req.user.role === 'admin';
    const isManager = project.manager_id.toString() === req.user._id.toString();
    if (!isAdmin && !isManager)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const updates = { ...req.body };
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Validate client_id if being updated
    if (updates.client_id) {
      if (!isValidObjectId(updates.client_id)) {
        return res.status(400).json({ success: false, message: 'Invalid client_id' });
      }
      const clientExists = await Client.findById(updates.client_id);
      if (!clientExists) {
        return res.status(404).json({ success: false, message: 'Client not found' });
      }
    }

    if (Array.isArray(updates.project_types) && updates.project_types.length > 0) {
      updates.project_type = updates.project_types[0];
    } else if (updates.project_type && !updates.project_types) {
      updates.project_types = [updates.project_type];
    }

    if (updates.status === 'completed') {
      updates.completed_at = updates.completed_at ?? new Date();
    } else if (updates.status && updates.status !== 'completed') {
      updates.completed_at = null;
    }

    if (updates.end_date || updates.start_date) {
      const newStart = updates.start_date ? new Date(updates.start_date) : project.start_date;
      const newEnd   = updates.end_date   ? new Date(updates.end_date)   : project.end_date;
      if (newEnd <= newStart)
        return res.status(400).json({ success: false, message: 'end_date must be after start_date' });
    }

    const updated = await Project.findByIdAndUpdate(
      id, { $set: updates }, { new: true, runValidators: true }
    )
      .populate('manager_id', 'name email')
      .populate('client_id',  'name companyName email');

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    if (error.name === 'ValidationError')
      return res.status(400).json({ success: false, message: error.message });
    return handleError(res, error);
  }
};

// ─── DELETE PROJECT ───────────────────────────────────────────────────────────

const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const project = await Project.findByIdAndDelete(id);
    if (!project)
      return res.status(404).json({ success: false, message: 'Project not found' });

    // Cleanup related data
    const assignmentIds = await Assignment.find({ project_id: id }).distinct('_id');
    await Promise.all([
      ProjectMember.deleteMany({ project_id: id }),
      Task.deleteMany({ project_id: id }),
      Assignment.deleteMany({ project_id: id }),
      AssignmentMember.deleteMany({ assignment_id: { $in: assignmentIds } }),
    ]);

    // Cleanup uploaded document if present
    if (project.document_path) {
      const fs = require('fs');
      try { fs.unlinkSync(project.document_path); } catch (_) { /* ignore */ }
    }

    return res.status(200).json({ success: true, message: 'Project and related data deleted' });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── STATS ────────────────────────────────────────────────────────────────────

const getProjectStats = async (req, res) => {
  try {
    const matchStage = req.user.role === 'manager' ? { manager_id: req.user._id } : {};
    const [byStatus, byPriority] = await Promise.all([
      Project.aggregate([{ $match: matchStage }, { $group: { _id: '$status',   count: { $sum: 1 } } }]),
      Project.aggregate([{ $match: matchStage }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    ]);
    const toMap = (arr) => arr.reduce((acc, { _id, count }) => ({ ...acc, [_id]: count }), {});
    return res.status(200).json({
      success: true,
      data: {
        by_status:   toMap(byStatus),
        by_priority: toMap(byPriority),
        total:       await Project.countDocuments(matchStage),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GENERATE PLAN ────────────────────────────────────────────────────────────

const generateProjectPlan = async (req, res) => {
  try {
    const { projectTypes, description } = req.body;
    if (!projectTypes || !Array.isArray(projectTypes) || projectTypes.length === 0)
      return res.status(400).json({ success: false, message: 'projectTypes must be a non-empty array' });
    const plan = generateUnifiedProjectPlan(projectTypes, description || '');
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── UPLOAD / REPLACE PROJECT DOCUMENT ───────────────────────────────────────

const uploadProjectDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id))
      return res.status(400).json({ success: false, message: 'Invalid project ID' });

    const project = await Project.findById(id).select('document_path title manager_id');
    if (!project)
      return res.status(404).json({ success: false, message: 'Project not found' });

    const isAdmin   = req.user.role === 'admin';
    const isManager = project.manager_id?.toString() === req.user._id.toString();
    if (!isAdmin && !isManager)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    if (!req.file)
      return res.status(400).json({ success: false, message: 'No file uploaded' });

    if (project.document_path) {
      const fs = require('fs');
      try { fs.unlinkSync(project.document_path); } catch (_) { /* ignore missing */ }
    }

    let documentText          = null;
    let extractedDescription  = project.description;
    let extractedDeliverables = [];

    try {
      const parsed = await parseProjectDocument(req.file.path, project.title);
      documentText          = parsed.rawText      || null;
      extractedDescription  = parsed.description  || project.description;
      extractedDeliverables = parsed.deliverables || [];
    } catch (parseErr) {
      console.error('Document parsing failed:', parseErr.message);
    }

    const updated = await Project.findByIdAndUpdate(
      id,
      {
        $set: {
          document_path:          req.file.path,
          document_text:          documentText,
          extracted_description:  extractedDescription,
          extracted_deliverables: extractedDeliverables,
        },
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        document_path:          updated.document_path,
        extracted_deliverables: updated.extracted_deliverables,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
  getProjectStats,
  getProjectDocument,
  generateProjectPlan,
  uploadProjectDocument,
  getClientsForProject,   // NEW
};
