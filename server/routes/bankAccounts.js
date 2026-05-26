const express = require('express');
const ctrl = require('../controllers/bankAccountsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('bank.view'), ctrl.list);
router.post('/', requirePermission('bank.transact'), ctrl.create);
router.get('/:id', requirePermission('bank.view'), ctrl.getOne);
router.put('/:id', requirePermission('bank.transact'), ctrl.update);
router.delete('/:id', requirePermission('bank.transact'), ctrl.deactivate);

router.get(
  '/:id/transactions',
  requirePermission('bank.view'),
  ctrl.listTransactions,
);
router.post('/:id/deposit', requirePermission('bank.transact'), ctrl.deposit);
router.post(
  '/:id/withdrawal',
  requirePermission('bank.transact'),
  ctrl.withdrawal,
);
router.post('/:id/transfer', requirePermission('bank.transact'), ctrl.transfer);

module.exports = router;
