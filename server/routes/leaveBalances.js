const express = require('express');
const ctrl = require('../controllers/leaveBalancesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// List everyone's balances for a year — managers + admins.
router.get('/', requirePermission('attendance.view_all'), ctrl.listAll);

// Year-end carry-over — admin only (gated by mark_manual which is admin
// privilege in the seed).
router.post('/carry-over', requirePermission('attendance.mark_manual'), ctrl.carryOver);

// Per-employee balances. Self-view allowed; managers see all.
router.get('/:employeeId', (req, res, next) => {
  const perms = req.user?.permissions || [];
  const ownEmployeeId = req.user?.employee_id;
  if (
    perms.includes('attendance.view_all') ||
    (perms.includes('attendance.view_own') && ownEmployeeId === req.params.employeeId)
  ) {
    return ctrl.getBalances(req, res, next);
  }
  return res.status(403).json({
    success: false,
    error: { code: 'AUTH_NO_PERMISSION', message: 'No permission for this employee.' },
  });
});

// Updating entitlements — admin only (mark_manual is the admin gate).
router.put(
  '/:employeeId',
  requirePermission('attendance.mark_manual'),
  ctrl.updateBalances,
);

module.exports = router;
