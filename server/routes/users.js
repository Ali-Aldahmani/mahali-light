const express = require('express');
const ctrl = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('user.edit'), ctrl.list);
router.post('/', requirePermission('user.create'), ctrl.create);
router.get('/:id', requirePermission('user.edit'), ctrl.getOne);
router.put('/:id', requirePermission('user.edit'), ctrl.update);
router.delete('/:id', requirePermission('user.edit'), ctrl.softDelete);
router.post('/:id/force-logout', requirePermission('user.force_logout'), ctrl.forceLogout);
router.get('/:id/permissions',  requirePermission('user.change_role'), ctrl.getPermissions);
router.put('/:id/permissions',  requirePermission('user.change_role'), ctrl.setPermissions);

module.exports = router;
