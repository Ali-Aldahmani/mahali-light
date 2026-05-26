const express = require('express');
const ctrl = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('settings.view'), ctrl.list);
router.get('/:key', requirePermission('settings.view'), ctrl.getOne);
router.put('/:key', requirePermission('settings.edit'), ctrl.update);

module.exports = router;
