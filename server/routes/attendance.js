const express = require('express');
const ctrl = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Anything that lists/views all employees requires the "view_all" perm.
// Routes scoped to a specific employee are guarded inside the handlers if
// the requester wants their own data.
router.get('/', requirePermission('attendance.view_all'), ctrl.list);
router.get('/today', requirePermission('attendance.view_all'), ctrl.today);
router.get('/monthly', requirePermission('attendance.view_all'), ctrl.monthlySheet);

// Corrections — list / submit (any authed user) / approve / reject.
// Listing is scoped per-user in the controller: non-managers see only
// their own corrections.
router.get(
  '/corrections',
  requirePermission('attendance.view_own'),
  ctrl.listCorrections,
);
router.post(
  '/corrections',
  requirePermission('attendance.correction_request'),
  ctrl.submitCorrection,
);
router.put(
  '/corrections/:id/approve',
  requirePermission('attendance.correction_approve'),
  ctrl.approveCorrection,
);
router.put(
  '/corrections/:id/reject',
  requirePermission('attendance.correction_approve'),
  ctrl.rejectCorrection,
);

// Manual entry + update.
router.post('/', requirePermission('attendance.mark_manual'), ctrl.manualEntry);
router.put('/:id', requirePermission('attendance.mark_manual'), ctrl.update);

// Per-employee endpoints. Allow self-view via view_own; managers via view_all.
// Self-view enforcement is done inline using req.user.employeeId.
function selfOrViewAll(handler) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    const ownEmployeeId = req.user?.employee_id;
    if (
      perms.includes('attendance.view_all') ||
      (perms.includes('attendance.view_own') && ownEmployeeId === req.params.employeeId)
    ) {
      return handler(req, res, next);
    }
    return res.status(403).json({
      success: false,
      error: { code: 'AUTH_NO_PERMISSION', message: 'No permission for this employee.' },
    });
  };
}

router.get('/:employeeId', selfOrViewAll(ctrl.employeeHistory));
router.get('/:employeeId/summary', selfOrViewAll(ctrl.employeeSummary));

module.exports = router;
