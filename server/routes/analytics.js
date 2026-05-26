const express = require('express');
const ctrl = require('../controllers/analyticsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Light endpoints — anyone with dashboard access can hit these.
router.get('/kpis', requirePermission('analytics.view_dashboard'), ctrl.kpis);
router.get('/sparkline', requirePermission('analytics.view_dashboard'), ctrl.sparkline);
router.get('/daily-snapshot', requirePermission('analytics.view_dashboard'), ctrl.dailySnapshot);
router.get('/sales-timeline', requirePermission('analytics.view_dashboard'), ctrl.salesTimeline);
router.get('/category-breakdown', requirePermission('analytics.view_dashboard'), ctrl.categoryBreakdown);

// Full analytics hub — needs the broader view permission.
router.get('/net-profit-trends', requirePermission('analytics.view'), ctrl.netProfitTrends);
router.get('/top-products', requirePermission('analytics.view'), ctrl.topProducts);
router.get('/worst-products', requirePermission('analytics.view'), ctrl.worstProducts);
router.get('/top-suppliers', requirePermission('analytics.view'), ctrl.topSuppliers);
router.get('/worst-suppliers', requirePermission('analytics.view'), ctrl.worstSuppliers);
router.get('/top-customers', requirePermission('analytics.view'), ctrl.topCustomers);
router.get('/at-risk-customers', requirePermission('analytics.view'), ctrl.atRiskCustomers);

// Employee performance is special — own/all is enforced inside the
// controller so cashiers can still see their own stats from the dashboard.
router.get('/employee-performance', ctrl.employeePerformance);

router.get('/peak-hours', requirePermission('analytics.view_peaks'), ctrl.peakHours);
router.get('/peak-days', requirePermission('analytics.view_peaks'), ctrl.peakDays);
router.get('/peak-heatmap', requirePermission('analytics.view_peaks'), ctrl.peakHeatmap);
router.get('/peak-months', requirePermission('analytics.view_peaks'), ctrl.peakMonths);

router.get(
  '/product-seasonality/:id',
  requirePermission('analytics.view_seasonality'),
  ctrl.productSeasonality,
);

module.exports = router;
