const express = require('express');
const ctrl = require('../controllers/cashDrawerController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('cash.view'), ctrl.getState);
router.post('/open', requirePermission('cash.adjust'), ctrl.open);
router.post('/close', requirePermission('cash.adjust'), ctrl.close);
router.post('/adjust', requirePermission('cash.adjust'), ctrl.adjust);
router.post('/transfer', requirePermission('cash.adjust'), ctrl.transferToBank);

router.get(
  '/transactions',
  requirePermission('cash.view'),
  ctrl.listTransactions,
);
router.get('/sessions', requirePermission('cash.view'), ctrl.listSessions);
router.get('/sessions/:id', requirePermission('cash.view'), ctrl.getSession);
router.get('/transfers', requirePermission('cash.view'), ctrl.listTransfers);

module.exports = router;
