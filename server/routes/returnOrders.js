const express = require('express');
const ctrl = require('../controllers/returnOrdersController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/summary', requirePermission('return.request'), ctrl.summary);
router.get('/', requirePermission('return.request'), ctrl.list);
router.get('/:id', requirePermission('return.request'), ctrl.getOne);

module.exports = router;
