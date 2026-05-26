// Standalone variant lookup endpoints (the per-product routes live in
// server/routes/products.js).

const express = require('express');
const ctrl = require('../controllers/variantsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/barcode/:barcode', requirePermission('product.view'), ctrl.findByBarcode);
router.get('/sku/:sku', requirePermission('product.view'), ctrl.findBySku);
router.post(
  '/generate-barcode',
  requirePermission('product.create'),
  ctrl.generateBarcode,
);

module.exports = router;
