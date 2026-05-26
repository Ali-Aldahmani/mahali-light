const express = require('express');
const editRequests = require('../controllers/invoiceEditRequestsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/', requirePermission('invoice.edit_approve'), editRequests.listAll);

module.exports = router;
