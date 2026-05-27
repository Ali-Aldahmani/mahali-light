const express = require('express');
const ctrl = require('../controllers/errorLogsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());
router.use(requirePermission('errors.view_all'));

router.get('/', ctrl.list);
router.delete('/cleanup', requirePermission('errors.resolve'), ctrl.cleanup);
router.get('/:id', ctrl.getOne);
router.put('/:id/resolve', requirePermission('errors.resolve'), ctrl.resolve);

module.exports = router;
