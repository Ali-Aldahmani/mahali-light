const express = require('express');
const ctrl = require('../controllers/categoriesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('product.view'), ctrl.tree);
router.get('/flat', requirePermission('product.view'), ctrl.flat);
router.post('/', requirePermission('product.create'), ctrl.create);
router.get('/:id', requirePermission('product.view'), ctrl.getOne);
router.put('/:id', requirePermission('product.edit'), ctrl.update);
router.delete('/:id', requirePermission('product.delete'), ctrl.remove);

router.get('/:id/attributes', requirePermission('product.view'), ctrl.listAttributes);
router.put('/:id/attributes', requirePermission('product.edit'), ctrl.setAttributes);

module.exports = router;
