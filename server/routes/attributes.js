const express = require('express');
const ctrl = require('../controllers/attributesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('product.view'), ctrl.list);
router.post('/', requirePermission('product.create'), ctrl.create);
router.put('/:id', requirePermission('product.edit'), ctrl.update);
router.post('/:id/values', requirePermission('product.edit'), ctrl.addValue);
router.put('/:id/values', requirePermission('product.edit'), ctrl.reorderValues);
router.delete('/:id/values/:valueId', requirePermission('product.edit'), ctrl.removeValue);

module.exports = router;
