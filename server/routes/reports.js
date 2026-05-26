const express = require('express');
const attendanceCtrl = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// Phase 11 exposes attendance reports already; Phase 14 will plug additional
// report types into this same router.
const router = express.Router();
router.use(requireAuth());

router.get(
  '/attendance/monthly',
  requirePermission('report.attendance'),
  attendanceCtrl.reportMonthly,
);
router.get(
  '/attendance/summary',
  requirePermission('report.attendance'),
  attendanceCtrl.reportSummary,
);

module.exports = router;
