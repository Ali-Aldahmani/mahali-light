const express = require('express');
const ctrl = require('../controllers/warrantiesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/summary', requirePermission('warranty.view'), ctrl.summary);
router.get('/lookup', requirePermission('warranty.view'), ctrl.lookup);
router.get(
  '/product-stats/:productId',
  requirePermission('warranty.view'),
  ctrl.productStats,
);
router.get('/', requirePermission('warranty.view'), ctrl.list);
router.post('/', requirePermission('warranty.create'), ctrl.create);
router.get('/:id', requirePermission('warranty.view'), ctrl.getOne);
router.put('/:id', requirePermission('warranty.create'), ctrl.update);
// Voiding a warranty is a destructive operation — require the create
// permission (managers/admins by default).
router.post('/:id/void', requirePermission('warranty.create'), ctrl.voidOne);

module.exports = router;
