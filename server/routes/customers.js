const express = require('express');
const customers = require('../controllers/customersController');
const payments = require('../controllers/customerPaymentsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/search', requirePermission('customer.view'), customers.search);
router.get(
  '/outstanding',
  requirePermission('customer.view_balance'),
  customers.outstanding,
);

router.get('/', requirePermission('customer.view'), customers.list);
router.post('/', requirePermission('customer.create'), customers.create);
router.get('/:id', requirePermission('customer.view'), customers.getOne);
router.put('/:id', requirePermission('customer.edit'), customers.update);
router.delete('/:id', requirePermission('customer.delete'), customers.remove);

router.get(
  '/:id/invoices',
  requirePermission('customer.view'),
  customers.listInvoices,
);
router.get(
  '/:id/payments',
  requirePermission('customer.view'),
  payments.listForCustomer,
);
router.post(
  '/:id/payments',
  requirePermission('customer.collect_payment'),
  payments.createForCustomer,
);
router.get(
  '/:id/returns',
  requirePermission('customer.view'),
  customers.listReturns,
);
router.get(
  '/:id/warranties',
  requirePermission('customer.view'),
  customers.listWarranties,
);
router.get(
  '/:id/timeline',
  requirePermission('customer.view'),
  customers.listTimeline,
);

module.exports = router;
