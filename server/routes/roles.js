const express = require('express');
const ctrl = require('../controllers/rolesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/permissions/all', requirePermission('user.edit'), ctrl.listPermissions);

router.get('/', requirePermission('user.edit'), ctrl.list);
router.post('/', requirePermission('user.change_role'), ctrl.create);
router.get('/:id', requirePermission('user.edit'), ctrl.getOne);
router.put('/:id', requirePermission('user.change_role'), ctrl.update);
router.delete('/:id', requirePermission('user.change_role'), ctrl.remove);
router.put('/:id/permissions', requirePermission('user.change_role'), ctrl.setPermissions);

module.exports = router;
