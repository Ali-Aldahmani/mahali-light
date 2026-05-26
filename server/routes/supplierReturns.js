const express = require('express');
const returns = require('../controllers/supplierReturnsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('supplier.view'), returns.list);
router.post('/', requirePermission('supplier.purchase_order.create'), returns.create);
router.get('/:id', requirePermission('supplier.view'), returns.getOne);
router.put(
  '/:id/resolve',
  requirePermission('supplier.purchase_order.create'),
  returns.resolve,
);

module.exports = router;
