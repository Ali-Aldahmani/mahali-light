const express = require('express');
const ctrl = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permissions');
const { APPROVAL_PERMISSIONS } = require('../services/approvalsService');

const router = express.Router();
router.use(requireAuth());

// Preferences (mounted before the param routes so '/preferences' doesn't
// match ':id').
router.get('/preferences', ctrl.getPreferences);
router.put('/preferences', ctrl.updatePreferences);

// Approval queue helper — used by the sidebar badge and approvals page.
router.get(
  '/approvals/counts',
  requireAnyPermission(...APPROVAL_PERMISSIONS),
  ctrl.approvalCounts,
);
router.get(
  '/approvals/queue',
  requireAnyPermission(...APPROVAL_PERMISSIONS),
  ctrl.approvalQueue,
);

// Admin broadcast.
router.post('/broadcast', requirePermission('notification.broadcast'), ctrl.broadcast);

// Core CRUD.
router.get('/unread-count', ctrl.unreadCount);
router.get('/', ctrl.list);
router.put('/read-all', ctrl.markAllRead);
router.put('/:id/read', ctrl.markRead);
router.put('/:id/dismiss', ctrl.dismissOne);

module.exports = router;
