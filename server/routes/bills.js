const express = require('express');
const ctrl = require('../controllers/billsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('bills.view'), ctrl.list);
router.get('/:id', requirePermission('bills.view'), ctrl.detail);

router.post('/', requirePermission('bills.manage'), ctrl.create);
router.put('/:id', requirePermission('bills.manage'), ctrl.update);
router.delete('/:id', requirePermission('bills.manage'), ctrl.cancel);
router.post('/:id/pause', requirePermission('bills.manage'), ctrl.pause);
router.post('/:id/resume', requirePermission('bills.manage'), ctrl.resume);

module.exports = router;
