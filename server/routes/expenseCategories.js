const express = require('express');
const ctrl = require('../controllers/expenseCategoriesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('bills.view'), ctrl.list);
router.post('/', requirePermission('bills.manage'), ctrl.create);
router.put('/:id', requirePermission('bills.manage'), ctrl.update);
router.delete('/:id', requirePermission('bills.manage'), ctrl.remove);

module.exports = router;
