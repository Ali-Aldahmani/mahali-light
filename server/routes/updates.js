const express = require('express');
const controller = require('../controllers/updateCheckController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Reached by the "Check for updates" / "Install update" controls in
// Settings → About. All three actions are restricted to the Admin role
// (enforced in the controller) so it stays gated without a new permission row.
router.use(requireAuth());

router.get('/check', controller.check);
router.get('/status', controller.getStatus);
router.post('/install', controller.install);

module.exports = router;