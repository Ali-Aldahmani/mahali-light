const express = require('express');
const suppliers = require('../controllers/suppliersController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('supplier.view'), suppliers.list);
router.post('/', requirePermission('supplier.create'), suppliers.create);
router.get('/:id', requirePermission('supplier.view'), suppliers.getOne);
router.put('/:id', requirePermission('supplier.edit'), suppliers.update);
router.delete('/:id', requirePermission('supplier.delete'), suppliers.remove);

router.get(
  '/:id/purchase-orders',
  requirePermission('supplier.view'),
  suppliers.listPurchaseOrders,
);
router.get(
  '/:id/payments',
  requirePermission('supplier.view'),
  suppliers.listPayments,
);
router.get(
  '/:id/products',
  requirePermission('supplier.view'),
  suppliers.listProducts,
);
router.get(
  '/:id/returns',
  requirePermission('supplier.view'),
  suppliers.listReturns,
);
router.get(
  '/:id/timeline',
  requirePermission('supplier.view'),
  suppliers.listTimeline,
);

module.exports = router;
