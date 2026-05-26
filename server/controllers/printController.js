// Print is performed client-side (Electron's webContents.print). The server
// supplies the PDF to print and exposes settings. A "printers" endpoint is
// provided for completeness — it returns the printers reported by the server
// PC (where Express runs), but the frontend should prefer Electron's local
// listing when available because each cashier PC may have different devices.

const { generateInvoicePDF, generateReceiptPDF } = require('../services/pdfService');
const { getStoreSettings } = require('../config/storeSettings');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

async function printInvoice(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT invoice_number FROM invoices WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generateInvoicePDF(id);
    res.json({
      success: true,
      data: {
        invoiceNumber: rows[0].invoice_number,
        pdfPath: result.path,
        url: `/api/invoices/${id}/pdf`,
        printer: req.body?.printer || null,
        silent: req.body?.silent !== false,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function printReceipt(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT invoice_number FROM invoices WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const result = await generateReceiptPDF(id);
    res.json({
      success: true,
      data: {
        invoiceNumber: rows[0].invoice_number,
        pdfPath: result.path,
        url: `/api/invoices/${id}/receipt`,
        printer: req.body?.printer || null,
        widthMm: getStoreSettings().print?.thermalWidthMm || 80,
      },
    });
  } catch (err) {
    next(err);
  }
}

// In a pure-server setup we can't enumerate printers attached to client PCs.
// We return a placeholder list with a hint so the frontend knows to fall
// back to the Electron IPC bridge.
async function listPrinters(req, res, next) {
  try {
    res.json({
      success: true,
      data: {
        source: 'server',
        note: 'Server cannot enumerate per-client printers. Use the Electron IPC bridge (window.electron.getPrinters) on each cashier PC.',
        printers: [],
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { printInvoice, printReceipt, listPrinters };
