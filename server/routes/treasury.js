const express = require('express');
const ctrl = require('../controllers/treasuryController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/summary', requirePermission('cash.view'), ctrl.summary);

module.exports = router;
