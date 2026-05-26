const express = require('express');
const ctrl = require('../controllers/expensesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { uploadDocSingle } = require('../utils/upload');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('bills.view'), ctrl.list);
router.get('/summary', requirePermission('bills.view'), ctrl.summary);
router.get('/:id', requirePermission('bills.view'), ctrl.detail);

// Creating an expense (with optional inline receipt) is gated on bills.pay
// because it moves cash/bank balances just like a bill payment.
router.post(
  '/',
  requirePermission('bills.pay'),
  uploadDocSingle('receipt'),
  ctrl.create,
);
router.post(
  '/:id/receipt',
  requirePermission('bills.pay'),
  uploadDocSingle('file'),
  ctrl.uploadReceipt,
);
router.delete('/:id', requirePermission('bills.pay'), ctrl.remove);

module.exports = router;
