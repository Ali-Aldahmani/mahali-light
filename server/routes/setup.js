const express = require('express');
const ctrl = require('../controllers/setupController');

const router = express.Router();

router.get('/status', ctrl.status);
router.post('/complete', ctrl.complete);
router.get('/ping', ctrl.testConnection);

module.exports = router;
