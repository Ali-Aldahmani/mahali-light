const express = require('express');
const ctrl = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

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

function selfOrViewAll(req, next, proceed) {
  const perms = req.user?.permissions || [];
  const ownEmployeeId = req.user?.employee_id;
  if (
    perms.includes('attendance.view_all') ||
    (perms.includes('attendance.view_own') && ownEmployeeId === req.params.employeeId)
  ) {
    return proceed();
  }
  return next(
    new AppError(ERROR_CODES.AUTH_NO_PERMISSION, 'No permission for this employee.', {
      status: 403,
      details: { employeeId: req.params.employeeId },
    }),
  );
}

// Per-employee endpoints. Allow self-view via view_own; managers via view_all.
router.get('/:employeeId', (req, res, next) => {
  selfOrViewAll(req, next, () => ctrl.employeeHistory(req, res, next));
});
router.get('/:employeeId/summary', (req, res, next) => {
  selfOrViewAll(req, next, () => ctrl.employeeSummary(req, res, next));
});

router.selfOrViewAll = selfOrViewAll;
module.exports = router;
