const express = require('express');
const payments = require('../controllers/supplierPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { uploadDocSingle } = require('../utils/upload');

const router = express.Router();
router.use(requireAuth());

router.delete(
  '/:id',
  requirePermission('supplier.purchase_order.pay'),
  payments.remove,
);
router.post(
  '/:id/receipt',
  requirePermission('supplier.purchase_order.pay'),
  uploadDocSingle('file'),
  payments.uploadReceipt,
);

module.exports = router;
