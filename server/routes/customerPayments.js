const express = require('express');
const payments = require('../controllers/customerPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.delete(
  '/:id',
  requirePermission('customer.collect_payment'),
  payments.remove,
);

module.exports = router;
