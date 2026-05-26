const express = require('express');
const ctrl = require('../controllers/employeesController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

router.use(requireAuth());

router.get('/', requirePermission('employee.view'), ctrl.list);
router.post('/', requirePermission('employee.create'), ctrl.create);
router.get('/:id', requirePermission('employee.view'), ctrl.getOne);
router.put('/:id', requirePermission('employee.edit'), ctrl.update);
router.delete('/:id', requirePermission('employee.delete'), ctrl.softDelete);

module.exports = router;
