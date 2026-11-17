const fs = require('fs');
const { z } = require('zod');
const { ZipArchive } = require('archiver');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { generateInvoicePDF } = require('../services/pdfService');
const { exportToCSV, exportToExcel } = require('../services/reportExporter');
const { buildListFilters, INVOICE_SELECT, shapeInvoice } = require('./invoicesController');

// Each invoice PDF is rendered by Chromium (or read from cache), so a PDF
// download is capped well below a spreadsheet one.
const MAX_PDF = 200;
const MAX_ROWS = 10000;

const bodySchema = z
  .object({
    format: z.enum(['pdf', 'excel', 'csv']),
    // Invoices ticked one by one…
    ids: z.array(z.string().uuid()).min(1).max(MAX_ROWS).optional(),
    // …or every invoice matching the list's filters ("select all").
    filters: z
      .object({
        search: z.string().max(200).optional(),
        status: z.string().max(30).optional(),
        paymentStatus: z.string().max(30).optional(),
        dateFrom: z.string().max(30).optional(),
        dateTo: z.string().max(30).optional(),
      })
      .optional(),
  })
  .refine((b) => Boolean(b.ids) !== Boolean(b.filters), {
    message: 'Send either ids or filters.',
  });

const COLUMNS = [
  { key: 'invoiceNumber', label: 'Invoice' },
  { key: 'createdAt', label: 'Date', type: 'datetime' },
  { key: 'customerName', label: 'Customer' },
  { key: 'customerPhone', label: 'Phone' },
  { key: 'customerCompany', label: 'Company' },
  { key: 'itemCount', label: 'Items', type: 'int', align: 'right' },
  { key: 'subtotal', label: 'Subtotal', type: 'currency', align: 'right' },
  { key: 'taxAmount', label: 'VAT', type: 'currency', align: 'right' },
  { key: 'total', label: 'Total', type: 'currency', align: 'right' },
  { key: 'amountPaid', label: 'Paid', type: 'currency', align: 'right' },
  { key: 'balanceDue', label: 'Balance', type: 'currency', align: 'right' },
  { key: 'paymentStatus', label: 'Payment' },
  { key: 'status', label: 'Status' },
  { key: 'createdByUsername', label: 'Created by' },
  { key: 'pcIdentifier', label: 'Till' },
];

// Store wall-clock time (the process runs in the store time zone), so the
// file name matches the clock on the till.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The spreadsheet reads like the list on screen.
function toRow(inv) {
  return {
    ...inv,
    customerName: inv.customerName || 'Guest',
    paymentStatus: capitalize(inv.paymentStatus),
    status: capitalize(inv.status),
  };
}

function safeFilename(s) {
  return String(s || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '_');
}

function attachment(res, type, filename) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
}

async function selectInvoices({ ids, filters }) {
  let whereSql;
  let params;
  if (ids) {
    params = [ids];
    whereSql = 'WHERE i.id = ANY($1::uuid[])';
  } else {
    const built = buildListFilters(filters);
    params = built.params;
    whereSql = built.where.length ? `WHERE ${built.where.join(' AND ')}` : '';
  }
  // One more than the cap tells "too many" apart from "exactly the cap".
  params.push(MAX_ROWS + 1);
  const { rows } = await query(
    `${INVOICE_SELECT}
     ${whereSql}
     ORDER BY i.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => shapeInvoice(r));
}

async function sendPdf(res, invoices) {
  if (invoices.length === 1) {
    const inv = invoices[0];
    const { absPath } = await generateInvoicePDF(inv.id);
    attachment(res, 'application/pdf', `${safeFilename(inv.invoiceNumber)}.pdf`);
    fs.createReadStream(absPath).pipe(res);
    return;
  }

  // Render every PDF before the first byte goes out, so a failure is a
  // proper error response rather than a half-written zip.
  const files = [];
  for (const inv of invoices) {
    const { absPath } = await generateInvoicePDF(inv.id);
    files.push({ absPath, name: `${safeFilename(inv.invoiceNumber)}.pdf` });
  }

  attachment(res, 'application/zip', `invoices-${stamp()}.zip`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err) => {
    console.error('[invoiceExport] zip failed:', err.message);
    res.destroy(err);
  });
  zip.pipe(res);
  for (const f of files) zip.file(f.absPath, { name: f.name });
  await zip.finalize();
}

async function exportInvoices(req, res, next) {
  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, parsed.error.issues[0]?.message, {
        status: 400,
      });
    }
    const { format } = parsed.data;
    const invoices = await selectInvoices(parsed.data);

    if (!invoices.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'No invoices to download.', {
        status: 404,
      });
    }
    if (invoices.length > MAX_ROWS) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `Too many invoices (more than ${MAX_ROWS}). Narrow the filters and try again.`,
        { status: 400 },
      );
    }
    if (format === 'pdf' && invoices.length > MAX_PDF) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `PDF download is limited to ${MAX_PDF} invoices at a time (${invoices.length} selected). Use Excel or CSV, or select fewer.`,
        { status: 400 },
      );
    }

    // Who took a copy of which sales (customer names and phones) is worth
    // a trail; best-effort, it never blocks the download.
    logActivity({
      entityType: 'invoice',
      action: 'invoice.export',
      performedBy: req.user?.id || null,
      newValue: { format, count: invoices.length },
    });

    if (format === 'pdf') {
      await sendPdf(res, invoices);
      return;
    }

    const report = { type: 'invoices', title: 'Invoices', columns: COLUMNS, rows: invoices.map(toRow) };
    if (format === 'csv') {
      const csv = await exportToCSV(report);
      attachment(res, 'text/csv; charset=utf-8', `invoices-${stamp()}.csv`);
      res.send(csv);
      return;
    }

    const { absPath } = await exportToExcel(report);
    attachment(
      res,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `invoices-${stamp()}.xlsx`,
    );
    const stream = fs.createReadStream(absPath);
    // The spreadsheet is a one-off; don't leave it in the reports folder.
    stream.on('close', () => fs.unlink(absPath, () => {}));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = { exportInvoices, MAX_PDF, MAX_ROWS };
