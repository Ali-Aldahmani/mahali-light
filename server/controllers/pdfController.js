const fs = require('fs');
const { query } = require('../db/postgres');
const {
  generateInvoicePDF,
  generateReceiptPDF,
  generatePurchaseOrderPDF,
} = require('../services/pdfService');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

function safeFilename(s) {
  return String(s || 'document').replace(/[^A-Za-z0-9._-]+/g, '_');
}

function streamPdfFile(res, absPath, downloadName) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${safeFilename(downloadName)}.pdf"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  const stream = fs.createReadStream(absPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
}

async function getInvoicePdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, invoice_number FROM invoices WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generateInvoicePDF(id);
    if (!fs.existsSync(result.absPath)) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'PDF file missing on server.',
        { status: 500 },
      );
    }
    streamPdfFile(res, result.absPath, rows[0].invoice_number);
  } catch (err) {
    next(err);
  }
}

async function regenerateInvoicePdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, invoice_number FROM invoices WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generateInvoicePDF(id, { force: true });
    res.json({
      success: true,
      data: { invoiceNumber: rows[0].invoice_number, pdfPath: result.path },
    });
  } catch (err) {
    next(err);
  }
}

async function getReceiptPdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, invoice_number FROM invoices WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generateReceiptPDF(id);
    streamPdfFile(res, result.absPath, `${rows[0].invoice_number}-receipt`);
  } catch (err) {
    next(err);
  }
}

async function getPurchaseOrderPdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, po_number FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generatePurchaseOrderPDF(id);
    streamPdfFile(res, result.absPath, rows[0].po_number);
  } catch (err) {
    next(err);
  }
}

async function regeneratePurchaseOrderPdf(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, po_number FROM purchase_orders WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generatePurchaseOrderPDF(id, { force: true });
    res.json({
      success: true,
      data: { poNumber: rows[0].po_number, pdfPath: result.path },
    });
  } catch (err) {
    next(err);
  }
}

// Lightweight: return the cached PDF metadata (no regeneration). Used by the
// frontend to know whether to enable a "View cached" link.
async function invoicePdfMeta(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT pdf_path, pdf_generated_at, updated_at, invoice_number, status FROM invoices WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const r = rows[0];
    res.json({
      success: true,
      data: {
        invoiceNumber: r.invoice_number,
        status: r.status,
        pdfPath: r.pdf_path,
        pdfGeneratedAt: r.pdf_generated_at,
        upToDate:
          r.pdf_generated_at && r.updated_at
            ? new Date(r.pdf_generated_at) >= new Date(r.updated_at)
            : false,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getInvoicePdf,
  regenerateInvoicePdf,
  getReceiptPdf,
  getPurchaseOrderPdf,
  regeneratePurchaseOrderPdf,
  invoicePdfMeta,
  _safeFilename: safeFilename,
};
