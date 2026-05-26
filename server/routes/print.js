const express = require('express');
const print = require('../controllers/printController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/printers', print.listPrinters);
router.post('/invoice/:id', requirePermission('invoice.print'), print.printInvoice);
router.post('/receipt/:id', requirePermission('invoice.print'), print.printReceipt);

module.exports = router;
