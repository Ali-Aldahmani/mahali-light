const express = require('express');
const ctrl = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Registry — frontend hub uses this to enumerate the available report
// types. The per-type permission check still runs on each request.
router.get('/registry', ctrl.listRegistry);

// Scheduled reports — admin only (gated via report.schedule).
router.get('/scheduled', requirePermission('report.schedule'), ctrl.listSchedules);
router.post('/scheduled', requirePermission('report.schedule'), ctrl.createSchedule);
router.put('/scheduled/:id', requirePermission('report.schedule'), ctrl.updateSchedule);
router.delete('/scheduled/:id', requirePermission('report.schedule'), ctrl.deleteSchedule);
router.post('/scheduled/:id/run', requirePermission('report.schedule'), ctrl.runScheduleNow);

// Generic data + export endpoints. Per-type permissions are enforced inside
// the controller because each type maps to a different module.
router.get('/:type', ctrl.runReport);
router.get('/:type/export', ctrl.exportReport);

module.exports = router;
