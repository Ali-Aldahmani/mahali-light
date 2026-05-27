const express = require('express');
const ctrl = require('../controllers/backupController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Read endpoints
router.get('/status', ctrl.maintenanceStatus);
router.get('/jobs', requirePermission('backup.view'), ctrl.listJobs);
router.get('/jobs/:id', requirePermission('backup.view'), ctrl.getJob);
router.get('/jobs/:id/download', requirePermission('backup.view'), ctrl.downloadJob);
router.get('/disk-usage', requirePermission('backup.view'), ctrl.diskUsage);
router.get('/destinations', requirePermission('backup.view'), ctrl.destinations);
router.get('/usb-drives', requirePermission('backup.view'), ctrl.usbDrives);

// Settings
router.get('/settings', requirePermission('backup.view'), ctrl.getSettings);
router.put('/settings', requirePermission('backup.configure'), ctrl.updateSettings);

// Actions
router.post('/run', requirePermission('backup.run_manual'), ctrl.runManual);
router.post('/restore/:jobId', requirePermission('backup.restore'), ctrl.restore);
router.post('/test-nas', requirePermission('backup.configure'), ctrl.testNas);
router.post('/retention/cleanup', requirePermission('backup.configure'), ctrl.runRetentionCleanup);

module.exports = router;
