const express = require('express');
const ctrl = require('../controllers/leavesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Listing / detail — viewable by anyone with attendance.view_own (filtered
// in the UI to own data) or attendance.view_all (everyone).
router.get('/', requirePermission('attendance.view_own'), ctrl.list);
router.get('/calculate-days', requirePermission('attendance.view_own'), ctrl.calculateDays);
router.get('/:id', requirePermission('attendance.view_own'), ctrl.detail);

// Submitting a leave request — any employee.
router.post('/', requirePermission('attendance.view_own'), ctrl.submit);

// Cancel own pending leave.
router.put('/:id/cancel', requirePermission('attendance.view_own'), ctrl.cancel);

// Approve / reject — managers + admins (attendance.correction_approve carries
// these privileges since both roles need it for the leave workflow).
router.put(
  '/:id/approve',
  requirePermission('attendance.correction_approve'),
  ctrl.approve,
);
router.put(
  '/:id/reject',
  requirePermission('attendance.correction_approve'),
  ctrl.reject,
);

module.exports = router;
