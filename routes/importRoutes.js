/**
 * routes/importRoutes.js
 */
const express = require('express');
const router  = express.Router();

const { protect, authorise } = require('../middleware/authMiddleware');
const { uploadExcel }        = require('../middleware/uploadMiddleware');
const {
  importTasksFromExcelController,
  downloadTemplate,
} = require('../controllers/importController');

router.get('/template',           protect, downloadTemplate);
router.post('/tasks/:projectId',  protect, authorise('admin', 'manager'), uploadExcel, importTasksFromExcelController);

module.exports = router;
