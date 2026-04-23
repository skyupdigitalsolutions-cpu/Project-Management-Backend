/**
 * server.js  (UPDATED)
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES FROM ORIGINAL:
 *  1. Import workflowHandlers — registers event listeners on startup
 *  2. Both workflowHandlers and initCronJobs called after mongoose.connect()
 *     (must be after DB ready so service functions can query DB)
 *  3. Everything else unchanged
 *
 * STARTUP ORDER (important):
 *   1. Express app created + middleware registered
 *   2. mongoose.connect()
 *   3. require('./services/workflowHandlers')  ← registers event listeners
 *   4. initCronJobs()                          ← starts cron jobs
 *   5. app.listen()
 */

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
require('dotenv').config();

const routes = require('./routes/Index');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const path = require('path');
app.use('/uploads', require('./middleware/authMiddleware').protect, express.static(path.join(__dirname, 'uploads')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running', environment: process.env.NODE_ENV || 'development' });
});

// ─── Seed Admin ───────────────────────────────────────────────────────────────
app.get('/seed-admin', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const User   = require('./models/users');
    const existing = await User.findOne({ email: 'admin@company.com' });
    if (existing) return res.json({ message: 'Admin already exists' });
    const password = await bcrypt.hash('admin123', await bcrypt.genSalt(10));
    await User.create({ name: 'Admin', email: 'admin@company.com', password, role: 'admin', status: 'active', department: 'Administration', designation: 'System Administrator' });
    res.json({ message: '✅ Admin created! Email: admin@company.com / Password: admin123' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error' : err.message || 'Internal server error';
  res.status(statusCode).json({ success: false, message });
});

// ─── Database + Server Startup ────────────────────────────────────────────────
const PORT      = process.env.PORT      || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/project-management';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Database connected!');

    // ── STEP 1: Register event-driven workflow handlers ─────────────────────
    // Must be called AFTER DB connect so handlers can query models.
    // This registers listeners for: project:created, task:created,
    // task:updated, leave:approved, workload:exceeded
    require('./services/workflowHandlers');

    // ── STEP 2: Start cron jobs ─────────────────────────────────────────────
    const { initCronJobs } = require('./services/Cronscheduler');
    initCronJobs();

    // ── STEP 3: Start HTTP server ───────────────────────────────────────────
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });