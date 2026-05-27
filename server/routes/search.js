const express = require('express');
const ctrl = require('../controllers/searchController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth());
router.get('/', ctrl.global);

module.exports = router;
