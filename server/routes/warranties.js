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
// Editing and voiding are separate from creating: cashiers create the
// warranties on their sales, but changing or cancelling one is a manager's
// call (warranty.edit / warranty.void, Manager and Admin by default).
router.put('/:id', requirePermission('warranty.edit'), ctrl.update);
router.post('/:id/void', requirePermission('warranty.void'), ctrl.voidOne);

module.exports = router;
