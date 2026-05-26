const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const fastcsv = require('fast-csv');
const { ensurePdfDir, getUploadsRoot } = require('../utils/paths');
const { getStoreSettings } = require('../config/storeSettings');

let pdfServiceModule = null;
function safePdfService() {
  if (pdfServiceModule) return pdfServiceModule;
  try {
    // eslint-disable-next-line global-require
    pdfServiceModule = require('./pdfService');
    return pdfServiceModule;
  } catch (err) {
    console.warn('[reportExporter] pdfService unavailable:', err.message);
    return null;
  }
}

// =======================================================================
// Cell formatters — kept in sync across all three export targets so a CSV
// row and an Excel row never disagree.
// =======================================================================
function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNumber(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('en-AE', { maximumFractionDigits: 2 });
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCell(value, type) {
  if (value == null || value === '') return '';
  switch (type) {
    case 'currency':
      return `AED ${fmtMoney(value)}`;
    case 'number':
      return fmtNumber(value);
    case 'percent':
      return `${fmtNumber(value)}%`;
    case 'int':
      return String(Math.round(Number(value) || 0));
    case 'date':
      return fmtDate(value);
    case 'datetime':
      return fmtDateTime(value);
    default:
      return String(value);
  }
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

// =======================================================================
// CSV — UTF-8 with BOM so Excel respects the encoding.
// =======================================================================
async function exportToCSV(report) {
  return new Promise((resolve, reject) => {
    const cols = report.columns || [];
    const rows = report.rows || [];
    const out = [];
    const stream = fastcsv.format({ headers: false, quoteColumns: true });
    stream.on('data', (chunk) => out.push(chunk));
    stream.on('end', () => {
      const body = Buffer.concat(out.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      resolve(Buffer.concat([bom, body]).toString('utf8'));
    });
    stream.on('error', reject);

    stream.write(cols.map((c) => c.label));
    for (const row of rows) {
      stream.write(cols.map((c) => formatCell(row[c.key], c.type)));
    }
    if (report.totals) {
      stream.write(
        cols.map((c, i) => {
          if (i === 0) return 'TOTAL';
          const v = report.totals[c.key];
          return v == null ? '' : formatCell(v, c.type);
        }),
      );
    }
    stream.end();
  });
}

// =======================================================================
// Excel — styled per spec: orange headers, alternating rows, frozen top
// row, auto-width, currency formatting on currency cells.
// =======================================================================
async function exportToExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mahali POS';
  wb.created = new Date();

  const ws = wb.addWorksheet(report.title || 'Report', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const cols = report.columns || [];
  const rows = report.rows || [];

  ws.columns = cols.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, (c.label?.length || 12) + 4)),
    style: {
      alignment: { horizontal: c.align || 'left' },
      numFmt:
        c.type === 'currency'
          ? '"AED" #,##0.00'
          : c.type === 'percent'
            ? '0.0"%"'
            : c.type === 'number'
              ? '#,##0.00'
              : c.type === 'int'
                ? '0'
                : c.type === 'date'
                  ? 'dd-mmm-yyyy'
                  : c.type === 'datetime'
                    ? 'dd-mmm-yyyy hh:mm'
                    : '@',
    },
  }));

  // Style the header row (orange bg, white text).
  ws.getRow(1).eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF97316' },
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  ws.getRow(1).height = 22;

  for (const r of rows) {
    const values = {};
    for (const c of cols) {
      let v = r[c.key];
      if (c.type === 'date' || c.type === 'datetime') {
        // ExcelJS handles JS Date objects nicely with numFmt.
        if (v) {
          const d = new Date(v);
          v = Number.isNaN(d.getTime()) ? v : d;
        }
      }
      values[c.key] = v ?? '';
    }
    ws.addRow(values);
  }

  // Alternating row shading (skip the header).
  for (let i = 2; i <= ws.rowCount; i += 1) {
    if (i % 2 === 0) continue;
    ws.getRow(i).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F6FA' },
      };
    });
  }

  if (report.totals) {
    const totalRow = ws.addRow(
      Object.fromEntries(
        cols.map((c, i) => [
          c.key,
          i === 0 ? 'TOTAL' : report.totals[c.key] ?? '',
        ]),
      ),
    );
    totalRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF97316' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });
    totalRow.height = 20;
  }

  // Auto-fit columns based on cell value lengths (cap at 40). The
  // ExcelJS worksheet iterator gives us safer access than column.eachCell
  // on freshly added rows.
  ws.columns.forEach((column, idx) => {
    let max = (column.header || '').length;
    for (let i = 2; i <= ws.rowCount; i += 1) {
      const cell = ws.getCell(i, idx + 1);
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    }
    column.width = Math.max(12, Math.min(40, max + 2));
  });

  const dir = ensureReportsDir();
  const filename = `${safeName(report.type)}-${stamp()}.xlsx`;
  const abs = path.join(dir, filename);
  await wb.xlsx.writeFile(abs);
  return { absPath: abs, filename };
}

// =======================================================================
// PDF — render the generic HTML template through the existing Puppeteer
// engine. Wide tables get landscape orientation.
// =======================================================================
async function exportToPDF(report, { user } = {}) {
  const pdf = safePdfService();
  if (!pdf) throw new Error('PDF service unavailable.');

  const settings = getStoreSettings();
  const cols = report.columns || [];
  const rows = report.rows || [];

  function headerHtml() {
    return cols
      .map((c) => {
        const align = c.align === 'right' ? ' class="right"' : '';
        return `<th${align}>${escapeHtml(c.label)}</th>`;
      })
      .join('');
  }
  function rowHtml(row) {
    return cols
      .map((c) => {
        const align = c.align === 'right' ? ' class="right"' : '';
        return `<td${align}>${escapeHtml(formatCell(row[c.key], c.type))}</td>`;
      })
      .join('');
  }

  const tableHtml = `
    <table>
      <thead><tr>${headerHtml()}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${rowHtml(r)}</tr>`).join('')}</tbody>
      ${
        report.totals
          ? `<tfoot><tr>${cols
              .map((c, i) => {
                const align = c.align === 'right' ? ' class="right"' : '';
                const v =
                  i === 0
                    ? 'TOTAL'
                    : report.totals[c.key] != null
                      ? formatCell(report.totals[c.key], c.type)
                      : '';
                return `<td${align}>${escapeHtml(v)}</td>`;
              })
              .join('')}</tr></tfoot>`
          : ''
      }
    </table>`;

  const summaryHtml = renderSummary(report);

  const filledTemplate = require('fs')
    .readFileSync(
      path.join(__dirname, '..', 'templates', 'reports', 'report-generic.html'),
      'utf8',
    )
    .replace(/\{\{title\}\}/g, escapeHtml(report.title || 'Report'))
    .replace(/\{\{storeName\}\}/g, escapeHtml(settings.storeName || 'Mahali Store'))
    .replace(/\{\{periodLabel\}\}/g, escapeHtml(report.period?.label || ''))
    .replace(/\{\{generatedBy\}\}/g, escapeHtml(user?.username || user?.name || 'System'))
    .replace(
      /\{\{generatedAt\}\}/g,
      escapeHtml(fmtDateTime(report.meta?.generatedAt || new Date())),
    )
    .replace(/\{\{logoTag\}\}/g, settings?.logoPath ? '' : '')
    .replace(/\{\{summaryHtml\}\}/g, summaryHtml.html)
    .replace(/\{\{summaryCols\}\}/g, String(summaryHtml.cols))
    .replace(/\{\{tableHtml\}\}/g, tableHtml)
    .replace(/\{\{footerNote\}\}/g, `${rows.length} row(s) · Mahali POS`);

  // Wider reports (> 6 cols) get landscape so all columns stay readable.
  const wide = cols.length > 6;
  const buf = await pdf.renderPdf(filledTemplate, {
    format: 'A4',
    landscape: wide,
    margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  });

  const dir = ensureReportsDir();
  const filename = `${safeName(report.type)}-${stamp()}.pdf`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, buf);
  return { absPath: abs, filename };
}

function renderSummary(report) {
  const s = report.summary;
  if (!s || typeof s !== 'object') return { html: '', cols: 1 };
  const entries = Object.entries(s).filter(([, v]) => v != null);
  if (!entries.length) return { html: '', cols: 1 };
  const cards = entries.map(([key, value]) => {
    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    const display =
      typeof value === 'number'
        ? key.toLowerCase().includes('count') || key.toLowerCase().includes('rate')
          ? formatCell(value, key.toLowerCase().includes('rate') ? 'percent' : 'int')
          : formatCell(value, 'currency')
        : escapeHtml(String(value));
    return `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${display}</div></div>`;
  });
  return {
    html: `<div class="summary">${cards.join('')}</div>`,
    cols: Math.min(entries.length, 4),
  };
}

// =======================================================================
// Helpers
// =======================================================================
function ensureReportsDir() {
  const dir = path.join(getUploadsRoot(), 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Sub-folder for scheduled drops.
  const scheduled = path.join(dir, 'scheduled');
  if (!fs.existsSync(scheduled)) fs.mkdirSync(scheduled, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeName(input) {
  return String(input || 'report').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

module.exports = {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  formatCell,
  ensureReportsDir,
  ensurePdfDir,
};
