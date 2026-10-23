const express = require('express');
const ctrl = require('../controllers/telegramController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('settings.view'), ctrl.get);
router.put('/', requirePermission('settings.edit'), ctrl.update);
router.post('/detect-chat', requirePermission('settings.edit'), ctrl.detectChat);
router.post('/test', requirePermission('settings.edit'), ctrl.test);

module.exports = router;
