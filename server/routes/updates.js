const express = require('express');
const controller = require('../controllers/updateCheckController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Reached by the "Check for updates" / "Install update" controls in
// Settings → About. Version info is not sensitive, so any authenticated
// user may check; installing is restricted to the Admin role in the
// controller so it stays gated without a new permission row.
router.use(requireAuth());

router.get('/check', controller.check);
router.get('/status', controller.getStatus);
router.post('/install', controller.install);

module.exports = router;