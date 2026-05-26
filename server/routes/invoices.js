const express = require('express');
const invoices = require('../controllers/invoicesController');
const payments = require('../controllers/invoicePaymentsController');
const editRequests = require('../controllers/invoiceEditRequestsController');
const pdf = require('../controllers/pdfController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/next-number', requirePermission('invoice.create'), invoices.nextNumberPreview);

router.get('/', requirePermission('invoice.view'), invoices.list);
router.post('/', requirePermission('invoice.create'), invoices.create);

router.get('/:id', requirePermission('invoice.view'), invoices.getOne);
router.put('/:id/items', requirePermission('invoice.create'), invoices.updateItems);
router.post('/:id/confirm', requirePermission('invoice.create'), invoices.confirm);
router.post('/:id/cancel', requirePermission('invoice.cancel'), invoices.cancel);

router.get('/:id/payments', requirePermission('invoice.view'), payments.list);
router.post('/:id/payments', requirePermission('invoice.create'), payments.create);

// PDF / receipt routes — gated on view (anyone who can see the invoice can
// download), with manual force regeneration gated on print.
router.get('/:id/pdf', requirePermission('invoice.download'), pdf.getInvoicePdf);
router.get('/:id/pdf/meta', requirePermission('invoice.view'), pdf.invoicePdfMeta);
router.post(
  '/:id/pdf/regenerate',
  requirePermission('invoice.print'),
  pdf.regenerateInvoicePdf,
);
router.get('/:id/receipt', requirePermission('invoice.print'), pdf.getReceiptPdf);

router.get('/:id/edit-requests', requirePermission('invoice.view'), editRequests.listForInvoice);
router.post(
  '/:id/edit-request',
  requirePermission('invoice.edit_request'),
  editRequests.create,
);
router.put(
  '/:id/edit-request/:reqId/approve',
  requirePermission('invoice.edit_approve'),
  editRequests.approve,
);
router.put(
  '/:id/edit-request/:reqId/reject',
  requirePermission('invoice.edit_approve'),
  editRequests.reject,
);

module.exports = router;
