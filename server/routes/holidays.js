const express = require('express');
const ctrl = require('../controllers/holidaysController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

// Everyone can read holidays — calendars + leave forms need them.
router.get('/', ctrl.list);

// Admin only (mark_manual gates admin privileges in the seed).
router.post('/', requirePermission('attendance.mark_manual'), ctrl.add);
router.delete('/:id', requirePermission('attendance.mark_manual'), ctrl.remove);

module.exports = router;
