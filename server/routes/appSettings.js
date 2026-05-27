const express = require('express');
const ctrl = require('../controllers/appSettingsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.get('/public', ctrl.getPublic);

router.use(requireAuth());
router.get('/', requirePermission('settings.view'), ctrl.get);
router.put('/', requirePermission('settings.edit'), ctrl.update);

module.exports = router;
