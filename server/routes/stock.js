const express = require('express');
const movements = require('../controllers/stockMovementsController');
const adjustments = require('../controllers/stockAdjustmentsController');
const counts = require('../controllers/stockCountsController');
const alerts = require('../controllers/reorderAlertsController');
const reports = require('../controllers/stockReportsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Stock summary + movements ---------------------------------------------------
router.get('/summary', requirePermission('stock.view'), movements.summary);
router.get('/movements', requirePermission('stock.view'), movements.list);
router.get(
  '/movements/product/:productId',
  requirePermission('stock.view'),
  movements.listForProduct,
);
router.get(
  '/movements/variant/:variantId',
  requirePermission('stock.view'),
  movements.listForVariant,
);

// Adjustment requests ---------------------------------------------------------
router.get('/adjustments', requirePermission('stock.view'), adjustments.list);
router.post(
  '/adjustments',
  requirePermission('stock.adjust_request'),
  adjustments.create,
);
router.get(
  '/adjustments/:id',
  requirePermission('stock.view'),
  adjustments.getOne,
);
router.put(
  '/adjustments/:id/approve',
  requirePermission('stock.adjust_approve'),
  adjustments.approve,
);
router.put(
  '/adjustments/:id/reject',
  requirePermission('stock.adjust_approve'),
  adjustments.reject,
);

// Stock counts ----------------------------------------------------------------
router.get('/counts', requirePermission('stock.view'), counts.list);
router.post('/counts', requirePermission('stock.count_initiate'), counts.create);
router.get('/counts/:id', requirePermission('stock.view'), counts.getOne);
router.put(
  '/counts/:id/items',
  requirePermission('stock.count_initiate'),
  counts.updateItems,
);
router.post(
  '/counts/:id/submit',
  requirePermission('stock.count_initiate'),
  counts.submit,
);
router.put(
  '/counts/:id/approve',
  requirePermission('stock.count_approve'),
  counts.approve,
);
router.put(
  '/counts/:id/reject',
  requirePermission('stock.count_approve'),
  counts.reject,
);

// Reorder alerts --------------------------------------------------------------
router.get('/reorder-alerts', requirePermission('stock.view'), alerts.list);
router.put(
  '/reorder-alerts/:id/dismiss',
  requirePermission('stock.adjust_approve'),
  alerts.dismiss,
);
router.post(
  '/reorder-alerts/check',
  requirePermission('stock.adjust_approve'),
  alerts.checkAll,
);

// Reports ---------------------------------------------------------------------
router.get('/low-stock', requirePermission('stock.view'), reports.lowStock);
router.get('/dead-stock', requirePermission('stock.view'), reports.deadStock);
router.get(
  '/valuation',
  requirePermission('product.view_cost'),
  reports.valuation,
);

module.exports = router;
