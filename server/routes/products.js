const express = require('express');
const ctrl = require('../controllers/productsController');
const variantsCtrl = require('../controllers/variantsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { uploadSingle } = require('../utils/upload');

const router = express.Router();

router.use(requireAuth());

// Search and barcode-lookup must come before /:id to avoid being captured
// by the param route.
router.get('/search', requirePermission('product.view'), ctrl.search);
router.get(
  '/barcode-lookup/:code',
  requirePermission('product.create'),
  ctrl.lookupBarcode,
);

router.get('/', requirePermission('product.view'), ctrl.list);
router.post('/', requirePermission('product.create'), ctrl.create);

router.get('/:id', requirePermission('product.view'), ctrl.getOne);
router.put('/:id', requirePermission('product.edit'), ctrl.update);
router.delete('/:id', requirePermission('product.delete'), ctrl.remove);

router.get('/:id/history', requirePermission('product.view'), ctrl.history);
router.post(
  '/:id/image',
  requirePermission('product.edit'),
  uploadSingle('image'),
  ctrl.uploadImage,
);
router.delete('/:id/image', requirePermission('product.edit'), ctrl.deleteImage);

// Variants under products
router.get('/:id/variants', requirePermission('product.view'), variantsCtrl.list);
router.post(
  '/:id/variants',
  requirePermission('product.create'),
  variantsCtrl.create,
);
router.put(
  '/:id/variants/:vid',
  requirePermission('product.edit'),
  variantsCtrl.update,
);
router.delete(
  '/:id/variants/:vid',
  requirePermission('product.delete'),
  variantsCtrl.remove,
);
router.post(
  '/:id/variants/:vid/image',
  requirePermission('product.edit'),
  uploadSingle('image'),
  variantsCtrl.uploadImage,
);
router.delete(
  '/:id/variants/:vid/image',
  requirePermission('product.edit'),
  variantsCtrl.deleteVariantImage,
);

module.exports = router;
