const express = require('express');
const ctrl = require('../controllers/financeController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Reports.
router.get('/pl',            requirePermission('finance.view_pl'),            ctrl.pl);
router.get('/balance-sheet', requirePermission('finance.view_balance_sheet'), ctrl.balanceSheet);
router.get('/cash-flow',     requirePermission('finance.view_cashflow'),      ctrl.cashFlow);
router.get('/vat',           requirePermission('finance.view_vat'),           ctrl.vat);
router.get('/dashboard',     requirePermission('finance.view_dashboard'),     ctrl.dashboard);

// Journal — viewing requires finance.view_journal, posting manual entries
// requires Admin (enforced via finance.close_period / role check at the
// controller level).
router.get('/journal',       requirePermission('finance.view_journal'), ctrl.listJournal);
router.get('/journal/:id',   requirePermission('finance.view_journal'), ctrl.getJournalEntry);
router.post('/journal',      requirePermission('finance.close_period'), ctrl.postManualEntry);

// Chart of accounts.
router.get('/accounts',          requirePermission('finance.view_journal'), ctrl.listAccounts);
router.post('/accounts',         requirePermission('finance.close_period'), ctrl.addAccount);
router.put('/accounts/:id',      requirePermission('finance.close_period'), ctrl.updateAccount);
router.delete('/accounts/:id',   requirePermission('finance.close_period'), ctrl.deleteAccount);

// Periods.
router.get('/periods',                 requirePermission('finance.view_journal'), ctrl.listPeriods);
router.get('/periods/:id/checklist',   requirePermission('finance.view_journal'), ctrl.periodChecklist);
router.post('/periods/:id/close',      requirePermission('finance.close_period'), ctrl.closePeriod);

module.exports = router;
