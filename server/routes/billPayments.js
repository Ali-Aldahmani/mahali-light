const express = require('express');
const ctrl = require('../controllers/billPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { uploadDocSingle } = require('../utils/upload');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('bills.view'), ctrl.list);
router.get('/upcoming', requirePermission('bills.view'), ctrl.upcoming);

router.post(
  '/:id/pay',
  requirePermission('bills.pay'),
  uploadDocSingle('receipt'),
  ctrl.pay,
);
router.post(
  '/:id/receipt',
  requirePermission('bills.pay'),
  uploadDocSingle('file'),
  ctrl.uploadReceipt,
);

module.exports = router;
