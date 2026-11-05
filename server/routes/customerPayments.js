const express = require('express');
const payments = require('../controllers/customerPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.delete(
  '/:id',
  // Voiding hands the cash back out of the drawer, so it is not the same
  // authority as taking a payment.
  requirePermission('customer.void_payment'),
  payments.remove,
);

module.exports = router;
