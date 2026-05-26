const express = require('express');
const ctrl = require('../controllers/warrantyClaimsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/summary', requirePermission('warranty.view'), ctrl.summary);
router.get('/', requirePermission('warranty.view'), ctrl.list);
router.post('/', requirePermission('warranty.claim'), ctrl.createOne);
router.get('/:id', requirePermission('warranty.view'), ctrl.getOne);
router.put('/:id', requirePermission('warranty.claim'), ctrl.update);
router.post('/:id/resolve', requirePermission('warranty.claim'), ctrl.resolve);
router.post(
  '/:id/raise-supplier-claim',
  requirePermission('warranty.claim'),
  ctrl.raiseSupplier,
);
router.post(
  '/:id/supplier-resolved',
  requirePermission('warranty.claim'),
  ctrl.setSupplierResolved,
);

module.exports = router;
