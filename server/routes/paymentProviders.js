const express = require('express');
const ctrl = require('../controllers/paymentProvidersController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requireAnyPermission('invoice.create', 'finance.manage_payment_fees'), ctrl.list);
router.post('/', requirePermission('finance.manage_payment_fees'), ctrl.create);
router.put('/:id', requirePermission('finance.manage_payment_fees'), ctrl.update);

module.exports = router;
