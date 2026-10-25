const express = require('express');
const ctrl = require('../controllers/auditController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { validateBody } = require('../utils/validate');
const router = express.Router();
router.use(requireAuth());
router.get('/events', requirePermission('audit.view'), validateBody(ctrl.querySchema, 'query'), ctrl.list);
module.exports = router;
