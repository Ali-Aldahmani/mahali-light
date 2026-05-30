const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { query } = require('../db/postgres');
const {
  ensurePdfDir,
  getUploadsRoot,
  toRelative,
  toAbsolute,
} = require('../utils/paths');
const { getStoreSettings } = require('../config/storeSettings');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Puppeteer ships a copy of Chromium. We launch it lazily and reuse one
// browser instance across PDF jobs — launching Chromium costs ~1s and we
// don't want to pay that every time a cashier prints a receipt.
let browserPromise = null;
let puppeteerModule = null;

function loadPuppeteer() {
  if (puppeteerModule) return puppeteerModule;
  try {
    // eslint-disable-next-line global-require
    puppeteerModule = require('puppeteer');
    return puppeteerModule;
  } catch (err) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      'PDF generation is unavailable on this server: puppeteer is not installed.',
      { status: 503, details: { error: err.message } },
    );
  }
}

async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
    browserPromise = null;
  }
  const puppeteer = loadPuppeteer();
  browserPromise = puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch (_e) {
    // ignore
  } finally {
    browserPromise = null;
  }
}

// -- template helpers ----------------------------------------------------

// Cache template file contents after the first read so that repeated PDF
// requests (e.g. bulk invoice printing) do not pay the synchronous disk I/O
// cost on every call.  Templates are static files — they never change at
// runtime — so a process-lifetime cache is safe.
const _templateCache = new Map();

function loadTemplate(name) {
  if (_templateCache.has(name)) return _templateCache.get(name);
  const file = path.join(__dirname, '..', 'templates', name);
  const content = fs.readFileSync(file, 'utf8');
  _templateCache.set(name, content);
  return content;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    out = out.replace(re, value == null ? '' : String(value));
  }
  return out;
}

function fmtMoney(value, currency = 'AED') {
  const n = Number(value || 0);
  const formatted = n.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function logoBlock(settings) {
  if (settings.logoPath) {
    const abs = toAbsolute(settings.logoPath);
    if (abs && fs.existsSync(abs)) {
      const ext = path.extname(abs).slice(1).toLowerCase() || 'png';
      const buf = fs.readFileSync(abs);
      const dataUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
      return `<img class="logo" src="${dataUrl}" alt="Logo" />`;
    }
  }
  const initials = (settings.storeName || 'NL').slice(0, 2).toUpperCase();
  return `<div class="logo-fallback">${escapeHtml(initials)}</div>`;
}

// -- invoice PDF ---------------------------------------------------------

async function fetchInvoice(invoiceId) {
  const { rows } = await query(
    `SELECT i.*,
            c.name AS customer_name, c.phone AS customer_phone,
            c.company_name AS customer_company, c.trn_number AS customer_trn,
            c.email AS customer_email, c.address AS customer_address,
            u1.username AS created_by_username,
            u2.username AS confirmed_by_username
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u1 ON u1.id = i.created_by
       LEFT JOIN users u2 ON u2.id = i.confirmed_by
      WHERE i.id = $1`,
    [invoiceId],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Invoice not found.', {
      status: 404,
    });
  }
  const invoice = rows[0];
  const { rows: items } = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1
      ORDER BY position ASC, created_at ASC`,
    [invoiceId],
  );
  const { rows: payments } = await query(
    `SELECT * FROM invoice_payments WHERE invoice_id = $1
      ORDER BY timestamp ASC`,
    [invoiceId],
  );
  return { invoice, items, payments };
}

function renderInvoiceHtml({ invoice, items, payments }, settings) {
  const template = loadTemplate('invoice.html');
  const currency = settings.currency || 'AED';

  const cancelled = invoice.status === 'cancelled';
  const isReprint =
    invoice.pdf_generated_at &&
    Date.now() - new Date(invoice.pdf_generated_at).getTime() >
      24 * 60 * 60 * 1000;

  let watermark = '';
  if (cancelled) watermark = `<div class="watermark">CANCELLED</div>`;
  else if (isReprint) watermark = `<div class="watermark copy">COPY</div>`;

  const itemRows = items
    .map((it, idx) => {
      const attrs = it.variant_attributes
        ? Object.entries(it.variant_attributes)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
            .join(' · ')
        : '';
      const qty = Number(it.quantity);
      return `
        <tr>
          <td class="idx">${idx + 1}</td>
          <td class="product">
            <div class="name">${escapeHtml(it.product_name)}</div>
            ${attrs ? `<div class="attrs">${attrs}</div>` : ''}
            ${it.sku ? `<div class="sku">${escapeHtml(it.sku)}</div>` : ''}
          </td>
          <td class="right">${qty.toLocaleString('en-AE', { minimumFractionDigits: qty % 1 === 0 ? 0 : 2 })}</td>
          <td>${escapeHtml(it.unit_label || 'pcs')}</td>
          <td class="right">${fmtMoney(it.unit_price, currency)}</td>
          <td class="right">${Number(it.discount_amount || 0) > 0 ? '- ' + fmtMoney(it.discount_amount, currency) : '—'}</td>
          <td class="right">${fmtMoney(it.line_total, currency)}</td>
        </tr>`;
    })
    .join('');

  const paymentRows = payments.length
    ? payments
        .map(
          (p) => `
            <div class="row">
              <span>${escapeHtml(p.method)} ${p.notes ? `· ${escapeHtml(p.notes)}` : ''}</span>
              <span>${fmtMoney(p.amount, currency)}</span>
            </div>`,
        )
        .join('')
    : `<div class="row"><span>No payments recorded</span><span>—</span></div>`;

  const discountAmt = Number(invoice.discount_amount || 0);
  const discountRow =
    discountAmt > 0
      ? `<tr><td class="label">Discount</td><td class="value">- ${fmtMoney(discountAmt, currency)}</td></tr>`
      : '';

  const customerBlock = invoice.customer_id
    ? [
        invoice.customer_phone &&
          `<div class="line">${escapeHtml(invoice.customer_phone)}</div>`,
        invoice.customer_email &&
          `<div class="line">${escapeHtml(invoice.customer_email)}</div>`,
        invoice.customer_company &&
          `<div class="line">${escapeHtml(invoice.customer_company)}</div>`,
        invoice.customer_address &&
          `<div class="line">${escapeHtml(invoice.customer_address)}</div>`,
        invoice.customer_trn &&
          `<div class="line"><span class="strong">TRN:</span> ${escapeHtml(invoice.customer_trn)}</div>`,
      ]
        .filter(Boolean)
        .join('')
    : '<div class="line">Walk-in / Guest</div>';

  return fillTemplate(template, {
    WATERMARK: watermark,
    LOGO_BLOCK: logoBlock(settings),
    STORE_NAME: escapeHtml(settings.storeName),
    STORE_ADDRESS: escapeHtml(settings.storeAddress),
    STORE_PHONE: escapeHtml(settings.storePhone),
    STORE_EMAIL_BLOCK: settings.storeEmail
      ? ` · Email: ${escapeHtml(settings.storeEmail)}`
      : '',
    STORE_TRN: escapeHtml(settings.storeTRN),
    INVOICE_NUMBER: escapeHtml(invoice.invoice_number),
    INVOICE_DATE: fmtDateTime(invoice.confirmed_at || invoice.created_at),
    INVOICE_STATUS: escapeHtml((invoice.status || '').toUpperCase()),
    CASHIER_NAME: escapeHtml(
      invoice.confirmed_by_username || invoice.created_by_username || '—',
    ),
    PC_IDENTIFIER: escapeHtml(invoice.pc_identifier || '—'),
    CUSTOMER_NAME: escapeHtml(invoice.customer_name || 'Guest customer'),
    CUSTOMER_BLOCK: customerBlock,
    ITEM_ROWS: itemRows,
    SUBTOTAL: fmtMoney(invoice.subtotal, currency),
    DISCOUNT_ROW: discountRow,
    TAXABLE: fmtMoney(invoice.taxable_amount, currency),
    VAT_RATE: Number(invoice.tax_rate || settings.vatRate || 5).toFixed(0),
    VAT_AMOUNT: fmtMoney(invoice.tax_amount, currency),
    TOTAL: fmtMoney(invoice.total, currency),
    PAYMENT_ROWS: paymentRows,
    AMOUNT_PAID: fmtMoney(invoice.amount_paid, currency),
    BALANCE_DUE: fmtMoney(invoice.balance_due, currency),
    FOOTER_NOTE: escapeHtml(settings.invoiceFooterNote || ''),
    TERMS: escapeHtml(settings.invoiceTerms || ''),
  });
}

// CSP injected into every Puppeteer page before rendering.
//
// The headless Chromium instance runs with --no-sandbox, so we apply a strict
// Content-Security-Policy as the first meta tag in <head>. Even if a caller
// ever passes un-escaped HTML to renderPdf (e.g. via generateReportPDF), the
// policy blocks script execution and all external network requests inside the
// renderer — limiting the worst-case impact to malformed layout, not RCE.
//
// Allowed by design:
//   style-src  'unsafe-inline' — all template CSS is inline <style> blocks.
//   img-src    data: blob:     — logos are inlined as base64 data URIs; QR
//                                codes are generated as data: URLs by qrcode.
//   font-src   data:           — embedded font faces (if any template uses them).
const PUPPETEER_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;";

// Inserts the CSP meta tag as the first child of <head> so the parser applies
// the policy before it processes any other element in the document.
function injectCsp(html) {
  return html.replace(/(<head[^>]*>)/i, `$1<meta http-equiv="Content-Security-Policy" content="${PUPPETEER_CSP}">`);
}

async function renderPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(injectCsp(html), { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      landscape: Boolean(options.landscape),
      margin: options.margin || {
        top: '0',
        bottom: '0',
        left: '0',
        right: '0',
      },
      width: options.width,
      height: options.height,
    });
    return pdf;
  } finally {
    await page.close().catch(() => {});
  }
}

async function generateInvoicePDF(invoiceId, { force = false } = {}) {
  const data = await fetchInvoice(invoiceId);
  const invoice = data.invoice;

  const dir = ensurePdfDir('invoices');
  const file = path.join(dir, `${invoiceId}.pdf`);
  const relPath = toRelative(file);

  // Re-use cached PDF if the invoice hasn't changed since it was last
  // generated. We compare against the invoice's updated_at.
  if (
    !force &&
    invoice.pdf_path &&
    invoice.pdf_generated_at &&
    new Date(invoice.pdf_generated_at) >= new Date(invoice.updated_at) &&
    fs.existsSync(toAbsolute(invoice.pdf_path))
  ) {
    return {
      path: invoice.pdf_path,
      absPath: toAbsolute(invoice.pdf_path),
      cached: true,
    };
  }

  const settings = getStoreSettings();
  const html = renderInvoiceHtml(data, settings);
  const buf = await renderPdf(html, {
    format: 'A4',
    margin: {
      top: '12mm',
      bottom: '12mm',
      left: '10mm',
      right: '10mm',
    },
  });
  fs.writeFileSync(file, buf);

  await query(
    `UPDATE invoices SET pdf_path = $1, pdf_generated_at = NOW() WHERE id = $2`,
    [relPath, invoiceId],
  );

  return { path: relPath, absPath: file, cached: false };
}

// Generate (or regenerate) without throwing — used for fire-and-forget calls.
async function generateInvoicePDFSafe(invoiceId, opts) {
  try {
    return await generateInvoicePDF(invoiceId, opts);
  } catch (err) {
    console.warn(
      `[pdfService] invoice ${invoiceId} PDF generation failed:`,
      err.message,
    );
    return null;
  }
}

// -- thermal receipt -----------------------------------------------------

async function renderReceiptHtml({ invoice, items, payments }, settings) {
  const template = loadTemplate('receipt.html');
  const currency = settings.currency || 'AED';
  const widthMm = settings.print?.thermalWidthMm || 80;

  const cancelled = invoice.status === 'cancelled';

  const itemRows = items
    .map((it) => {
      const qty = Number(it.quantity);
      return `
        <tr>
          <td class="name">${escapeHtml(it.product_name)}</td>
          <td class="total">${fmtMoney(it.line_total, currency)}</td>
        </tr>
        <tr>
          <td class="qty" colspan="2">
            ${qty} ${escapeHtml(it.unit_label || 'pcs')} × ${fmtMoney(it.unit_price, currency)}
            ${Number(it.discount_amount || 0) > 0 ? ` · -${fmtMoney(it.discount_amount, currency)}` : ''}
          </td>
        </tr>`;
    })
    .join('');

  const cashTotal = payments
    .filter((p) => p.method === 'cash')
    .reduce((s, p) => s + Number(p.amount), 0);
  const bankTotal = payments
    .filter((p) => p.method === 'bank')
    .reduce((s, p) => s + Number(p.amount), 0);
  const creditTotal = payments
    .filter((p) => p.method === 'credit')
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalNum = Number(invoice.total || 0);
  const change = cashTotal > totalNum ? cashTotal - totalNum : 0;

  const paymentLines = [];
  if (cashTotal > 0)
    paymentLines.push(
      `<div class="totals-row"><span>Cash</span><span>${fmtMoney(cashTotal, currency)}</span></div>`,
    );
  if (bankTotal > 0)
    paymentLines.push(
      `<div class="totals-row"><span>Bank</span><span>${fmtMoney(bankTotal, currency)}</span></div>`,
    );
  if (creditTotal > 0)
    paymentLines.push(
      `<div class="totals-row"><span>Credit</span><span>${fmtMoney(creditTotal, currency)}</span></div>`,
    );
  if (change > 0)
    paymentLines.push(
      `<div class="totals-row strong"><span>Change</span><span>${fmtMoney(change, currency)}</span></div>`,
    );
  const paymentsBlock = paymentLines.length
    ? `<hr class="thin" />${paymentLines.join('')}`
    : '';

  // QR contents: pipe-separated values (storeTRN | invoice# | total | date).
  const qrPayload = [
    settings.storeTRN || '',
    invoice.invoice_number,
    Number(invoice.total || 0).toFixed(2),
    new Date(invoice.confirmed_at || invoice.created_at).toISOString(),
  ].join('|');
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 1,
    width: 200,
  });

  const discountAmt = Number(invoice.discount_amount || 0);
  const discountRow =
    discountAmt > 0
      ? `<div class="totals-row"><span>Discount</span><span>- ${fmtMoney(discountAmt, currency)}</span></div>`
      : '';

  const customerLine = invoice.customer_id
    ? `<div class="center meta">Customer: ${escapeHtml(invoice.customer_name || '')}</div>`
    : '';

  return fillTemplate(template, {
    PAGE_WIDTH_MM: widthMm,
    STORE_NAME: escapeHtml(settings.storeName),
    STORE_PHONE: escapeHtml(settings.storePhone || ''),
    STORE_TRN: escapeHtml(settings.storeTRN || ''),
    CANCELLED_BANNER: cancelled
      ? `<div class="cancelled">CANCELLED</div>`
      : '',
    INVOICE_NUMBER: escapeHtml(invoice.invoice_number),
    INVOICE_DATE: fmtDateTime(invoice.confirmed_at || invoice.created_at),
    CASHIER_NAME: escapeHtml(
      invoice.confirmed_by_username || invoice.created_by_username || '—',
    ),
    CUSTOMER_LINE: customerLine,
    ITEM_ROWS: itemRows,
    SUBTOTAL: fmtMoney(invoice.subtotal, currency),
    DISCOUNT_ROW: discountRow,
    VAT_RATE: Number(invoice.tax_rate || settings.vatRate || 5).toFixed(0),
    VAT_AMOUNT: fmtMoney(invoice.tax_amount, currency),
    TOTAL: fmtMoney(invoice.total, currency),
    PAYMENTS_BLOCK: paymentsBlock,
    FOOTER_NOTE: escapeHtml(settings.invoiceFooterNote || 'Thank you!'),
    QR_DATA_URL: qrDataUrl,
    TIMESTAMP: fmtDateTime(new Date()),
  });
}

async function generateReceiptPDF(invoiceId) {
  const data = await fetchInvoice(invoiceId);
  const settings = getStoreSettings();
  const widthMm = settings.print?.thermalWidthMm || 80;
  const html = await renderReceiptHtml(data, settings);
  const buf = await renderPdf(html, {
    width: `${widthMm}mm`,
    height: '297mm',
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });

  const dir = ensurePdfDir('receipts');
  const file = path.join(dir, `${invoiceId}.pdf`);
  fs.writeFileSync(file, buf);
  return { path: toRelative(file), absPath: file };
}

// -- purchase order PDF --------------------------------------------------

async function fetchPurchaseOrder(poId) {
  const { rows: poRows } = await query(
    `SELECT po.*, s.name AS supplier_name, s.contact_person, s.phone AS supplier_phone,
            s.email AS supplier_email, s.trn_number AS supplier_trn, s.address AS supplier_address,
            s.payment_terms AS supplier_payment_terms,
            u.username AS created_by_username
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.employee_id
      WHERE po.id = $1`,
    [poId],
  );
  if (!poRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Purchase order not found.', {
      status: 404,
    });
  }
  const po = poRows[0];
  const { rows: items } = await query(
    `SELECT i.*, p.name AS product_name, v.sku AS sku
       FROM purchase_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN product_variants v ON v.id = i.variant_id
      WHERE i.purchase_order_id = $1
      ORDER BY i.created_at ASC`,
    [poId],
  );
  const { rows: payments } = await query(
    `SELECT * FROM supplier_payments WHERE purchase_order_id = $1
      ORDER BY payment_date ASC, created_at ASC`,
    [poId],
  );
  return { po, items, payments };
}

function renderPurchaseOrderHtml({ po, items, payments }, settings) {
  const template = loadTemplate('purchase-order.html');
  const currency = settings.currency || 'AED';

  const itemRows = items
    .map((it, idx) => {
      const qty = Number(it.quantity);
      return `
        <tr>
          <td class="idx">${idx + 1}</td>
          <td>
            <div class="name">${escapeHtml(it.product_name || '—')}</div>
            ${it.sku ? `<div class="sku">${escapeHtml(it.sku)}</div>` : ''}
          </td>
          <td class="right">${qty.toLocaleString('en-AE', { minimumFractionDigits: qty % 1 === 0 ? 0 : 2 })}</td>
          <td>${escapeHtml(it.unit_label || 'pcs')}</td>
          <td class="right">${fmtMoney(it.cost_price_per_unit, currency)}</td>
          <td class="right">${fmtMoney(it.total_cost, currency)}</td>
        </tr>`;
    })
    .join('');

  const supplierBlock = [
    po.contact_person && `<div class="line">${escapeHtml(po.contact_person)}</div>`,
    po.supplier_phone && `<div class="line">${escapeHtml(po.supplier_phone)}</div>`,
    po.supplier_email && `<div class="line">${escapeHtml(po.supplier_email)}</div>`,
    po.supplier_address && `<div class="line">${escapeHtml(po.supplier_address)}</div>`,
    po.supplier_trn &&
      `<div class="line"><span class="strong">TRN:</span> ${escapeHtml(po.supplier_trn)}</div>`,
  ]
    .filter(Boolean)
    .join('');

  let paymentsBlock = '';
  if (payments.length) {
    const rows = payments
      .map(
        (p) =>
          `<div class="row">
             <span>${fmtDate(p.payment_date)} · ${escapeHtml(p.payment_method)}</span>
             <span>${fmtMoney(p.amount, currency)}</span>
           </div>`,
      )
      .join('');
    paymentsBlock = `
      <div class="payments">
        <h4>Payment history</h4>
        ${rows}
        <div class="row totals-row">
          <span>Paid</span>
          <span>${fmtMoney(po.amount_paid, currency)}</span>
        </div>
        <div class="row totals-row">
          <span>Balance due</span>
          <span>${fmtMoney(po.balance_due, currency)}</span>
        </div>
      </div>`;
  }

  return fillTemplate(template, {
    LOGO_BLOCK: logoBlock(settings),
    STORE_NAME: escapeHtml(settings.storeName),
    STORE_ADDRESS: escapeHtml(settings.storeAddress),
    STORE_PHONE: escapeHtml(settings.storePhone),
    STORE_TRN: escapeHtml(settings.storeTRN),
    PO_NUMBER: escapeHtml(po.po_number),
    ORDER_DATE: fmtDate(po.order_date),
    EXPECTED_DATE: fmtDate(po.expected_date),
    STATUS: escapeHtml((po.status || '').toUpperCase()),
    CREATED_BY: escapeHtml(po.created_by_username || '—'),
    SUPPLIER_NAME: escapeHtml(po.supplier_name || '—'),
    SUPPLIER_BLOCK: supplierBlock,
    PAYMENT_TERMS: escapeHtml(po.supplier_payment_terms || '—'),
    ITEM_ROWS: itemRows,
    SUBTOTAL: fmtMoney(po.subtotal, currency),
    TOTAL: fmtMoney(po.total_cost, currency),
    PAYMENTS_BLOCK: paymentsBlock,
    FOOTER_NOTE: escapeHtml(settings.poFooterNote || ''),
  });
}

async function generatePurchaseOrderPDF(poId, { force = false } = {}) {
  const data = await fetchPurchaseOrder(poId);
  const po = data.po;
  const dir = ensurePdfDir('purchase-orders');
  const file = path.join(dir, `${poId}.pdf`);
  const relPath = toRelative(file);

  if (
    !force &&
    po.pdf_path &&
    po.pdf_generated_at &&
    new Date(po.pdf_generated_at) >= new Date(po.updated_at) &&
    fs.existsSync(toAbsolute(po.pdf_path))
  ) {
    return {
      path: po.pdf_path,
      absPath: toAbsolute(po.pdf_path),
      cached: true,
    };
  }

  const settings = getStoreSettings();
  const html = renderPurchaseOrderHtml(data, settings);
  const buf = await renderPdf(html, {
    format: 'A4',
    margin: {
      top: '12mm',
      bottom: '12mm',
      left: '10mm',
      right: '10mm',
    },
  });
  fs.writeFileSync(file, buf);

  await query(
    `UPDATE purchase_orders SET pdf_path = $1, pdf_generated_at = NOW() WHERE id = $2`,
    [relPath, poId],
  );

  return { path: relPath, absPath: file, cached: false };
}

async function generatePurchaseOrderPDFSafe(poId, opts) {
  try {
    return await generatePurchaseOrderPDF(poId, opts);
  } catch (err) {
    console.warn(
      `[pdfService] PO ${poId} PDF generation failed:`,
      err.message,
    );
    return null;
  }
}

// -- generic report PDF --------------------------------------------------

/**
 * Render a generic report to a PDF file and return its path.
 *
 * SECURITY — `html` parameter contract:
 *   This function injects `html` verbatim into a Puppeteer page body.
 *   ALL callers MUST pass pre-sanitised markup (every user-supplied string run
 *   through escapeHtml()).  Passing raw user input here is an HTML-injection
 *   risk; even though the Puppeteer CSP (injected by renderPdf/injectCsp)
 *   blocks script execution, injected markup can still exfiltrate data via
 *   CSS or resource loads.
 *
 *   If you are adding a new call site, validate that every dynamic value in
 *   the HTML string has been escaped with escapeHtml() before reaching here.
 */
async function generateReportPDF({ title, html, reportType = 'report' }) {
  if (typeof html !== 'string') {
    throw new Error('[generateReportPDF] html must be a pre-sanitised string');
  }

  const dir = ensurePdfDir('reports');
  const stamp = new Date().toISOString().slice(0, 10);
  const safeType = String(reportType).replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const file = path.join(dir, `${safeType}-${stamp}-${Date.now()}.pdf`);

  const fullHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title || 'Report')}</title>
    <style>body{font-family:Inter,system-ui,sans-serif;color:#111827;padding:24px;}</style>
    </head><body>${html}</body></html>`;
  const buf = await renderPdf(fullHtml, {
    format: 'A4',
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
  });
  fs.writeFileSync(file, buf);
  return { path: toRelative(file), absPath: file };
}

// -- maintenance ---------------------------------------------------------

// Invalidate cached PDF (rows + on-disk) — called when an invoice or PO is
// edited or cancelled. Best-effort.
async function invalidateInvoicePDF(invoiceId) {
  try {
    const { rows } = await query(
      `SELECT pdf_path FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    const rel = rows[0]?.pdf_path;
    if (rel) {
      const abs = toAbsolute(rel);
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    await query(
      `UPDATE invoices SET pdf_path = NULL, pdf_generated_at = NULL WHERE id = $1`,
      [invoiceId],
    );
  } catch (err) {
    console.warn('[pdfService] invalidateInvoicePDF failed:', err.message);
  }
}

async function invalidatePurchaseOrderPDF(poId) {
  try {
    const { rows } = await query(
      `SELECT pdf_path FROM purchase_orders WHERE id = $1`,
      [poId],
    );
    const rel = rows[0]?.pdf_path;
    if (rel) {
      const abs = toAbsolute(rel);
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    await query(
      `UPDATE purchase_orders SET pdf_path = NULL, pdf_generated_at = NULL WHERE id = $1`,
      [poId],
    );
  } catch (err) {
    console.warn('[pdfService] invalidatePurchaseOrderPDF failed:', err.message);
  }
}

// Delete generated PDFs older than `maxAgeDays`. Used by the cleanup job.
async function cleanupOldPdfs({ maxAgeDays = 30 } = {}) {
  const root = path.join(getUploadsRoot(), 'pdfs');
  if (!fs.existsSync(root)) return { deleted: 0 };
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  function sweep(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sweep(full);
      else if (entry.isFile() && full.endsWith('.pdf')) {
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(full);
            deleted += 1;
          }
        } catch (_e) {
          // ignore
        }
      }
    }
  }
  sweep(root);
  return { deleted };
}

module.exports = {
  generateInvoicePDF,
  generateInvoicePDFSafe,
  generateReceiptPDF,
  generatePurchaseOrderPDF,
  generatePurchaseOrderPDFSafe,
  generateReportPDF,
  renderPdf,
  invalidateInvoicePDF,
  invalidatePurchaseOrderPDF,
  cleanupOldPdfs,
  closeBrowser,
};
