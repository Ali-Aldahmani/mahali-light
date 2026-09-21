const express = require('express');
const ctrl = require('../controllers/pricingRestrictionsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

// Admin-only management — matches the "Admin can configure" requirement;
// reading a single product's restriction is broader (product.view) so the
// POS/edit UI can reflect it without needing the management permission.
router.get('/', requirePermission('product.manage_pricing_restrictions'), ctrl.list);
router.post('/bulk', requirePermission('product.manage_pricing_restrictions'), ctrl.bulkApply);

router.get('/product/:productId', requirePermission('product.view'), ctrl.getForProduct);
router.put(
  '/product/:productId',
  requirePermission('product.manage_pricing_restrictions'),
  ctrl.upsertForProduct,
);
router.delete(
  '/product/:productId',
  requirePermission('product.manage_pricing_restrictions'),
  ctrl.removeForProduct,
);

module.exports = router;
