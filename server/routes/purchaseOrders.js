const express = require('express');
const pos = require('../controllers/purchaseOrdersController');
const payments = require('../controllers/supplierPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { uploadDocSingle } = require('../utils/upload');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('supplier.view'), pos.list);
router.post('/', requirePermission('supplier.purchase_order.create'), pos.create);
router.get('/:id', requirePermission('supplier.view'), pos.getOne);
router.put('/:id', requirePermission('supplier.purchase_order.create'), pos.update);
router.delete(
  '/:id',
  requirePermission('supplier.purchase_order.create'),
  pos.remove,
);

router.post(
  '/:id/confirm',
  requirePermission('supplier.purchase_order.create'),
  pos.confirm,
);
router.post(
  '/:id/receive',
  requirePermission('supplier.purchase_order.create'),
  pos.receive,
);
router.post(
  '/:id/attachment',
  requirePermission('supplier.purchase_order.create'),
  uploadDocSingle('file'),
  pos.uploadAttachment,
);
router.delete(
  '/:id/attachment',
  requirePermission('supplier.purchase_order.create'),
  pos.removeAttachment,
);

// Payments nested under PO --------------------------------------------------
router.get('/:id/payments', requirePermission('supplier.view'), payments.listForPo);
router.post(
  '/:id/payments',
  requirePermission('supplier.purchase_order.pay'),
  payments.createForPo,
);

module.exports = router;
