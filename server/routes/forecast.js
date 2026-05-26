const express = require('express');
const ctrl = require('../controllers/analyticsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/reorder', requirePermission('analytics.view_reorder'), ctrl.listReorder);
router.get('/reorder/:variantId', requirePermission('analytics.view_reorder'), ctrl.getReorder);
router.post('/reorder/:id/dismiss', requirePermission('analytics.view_reorder'), ctrl.dismissReorder);

router.get('/annual-plan', requirePermission('analytics.view_reorder'), ctrl.listAnnualPlan);
router.get('/annual-plan/:variantId', requirePermission('analytics.view_reorder'), ctrl.getAnnualPlan);
router.get(
  '/annual-plan/export/xlsx',
  requirePermission('analytics.export_forecast'),
  ctrl.exportAnnualPlan,
);

router.post(
  '/recalculate',
  requirePermission('analytics.manage_reorder_settings'),
  ctrl.recalculate,
);

module.exports = router;
