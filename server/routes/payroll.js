const express = require('express');
const ctrl = require('../controllers/payrollController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// Salaries are sensitive: every route needs a payroll permission (Admin by default).
const router = express.Router();
router.use(requireAuth());

router.get('/employees', requirePermission('payroll.view'), ctrl.listPay);
router.put('/employees/:id/pay', requirePermission('payroll.manage'), ctrl.setPay);

router.get('/runs', requirePermission('payroll.view'), ctrl.listRuns);
router.post('/runs', requirePermission('payroll.manage'), ctrl.createRun);
router.get('/runs/:id', requirePermission('payroll.view'), ctrl.getRun);
router.put('/runs/:id/lines/:lineId', requirePermission('payroll.manage'), ctrl.updateLine);
router.delete('/runs/:id', requirePermission('payroll.manage'), ctrl.deleteDraft);
router.post('/runs/:id/approve', requirePermission('payroll.approve'), ctrl.approve);
router.post('/runs/:id/pay', requirePermission('payroll.pay'), ctrl.pay);
router.post('/runs/:id/void', requirePermission('payroll.approve'), ctrl.voidRun);

router.get('/advances', requirePermission('payroll.view'), ctrl.listAdvances);
router.post('/advances', requirePermission('payroll.pay'), ctrl.issueAdvance);

module.exports = router;
