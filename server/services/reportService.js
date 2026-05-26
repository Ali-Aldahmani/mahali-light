const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const financialReportService = require('./financialReportService');

// =======================================================================
// Helpers
// =======================================================================
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Parses date range params. Defaults to "this month" so a missing query
// param never blows up — the caller can override with explicit dates.
function parseDateRange(params = {}) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const defStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const defEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return {
    startDate: dateOnly(params.start_date) || defStart,
    endDate: dateOnly(params.end_date) || defEnd,
  };
}

// Pretty period label for headers/PDFs.
function rangeLabel({ startDate, endDate }) {
  if (!startDate || !endDate) return '';
  return `${startDate} – ${endDate}`;
}

// =======================================================================
// Sales reports
// =======================================================================
async function salesSummary(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows: agg } = await query(
    `WITH inv AS (
       SELECT * FROM invoices
        WHERE status = 'confirmed'
          AND confirmed_at::date BETWEEN $1::date AND $2::date
     )
     SELECT
       (SELECT COUNT(*)::int FROM inv) AS invoice_count,
       (SELECT COALESCE(SUM(subtotal),0)::float8 FROM inv) AS gross_sales,
       (SELECT COALESCE(SUM(discount_amount + invoice_discount),0)::float8 FROM inv) AS discounts,
       (SELECT COALESCE(SUM(taxable_amount),0)::float8 FROM inv) AS net_sales,
       (SELECT COALESCE(SUM(tax_amount),0)::float8 FROM inv) AS vat,
       (SELECT COALESCE(SUM(total),0)::float8 FROM inv) AS total_collected,
       (SELECT COALESCE(SUM(ro.refund_total),0)::float8 FROM return_orders ro
         WHERE ro.created_at::date BETWEEN $1::date AND $2::date) AS refunds`,
    [startDate, endDate],
  );
  const { rows: byMethod } = await query(
    `SELECT ip.method, COALESCE(SUM(ip.amount),0)::float8 AS amount, COUNT(*)::int AS payments
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY ip.method
      ORDER BY amount DESC`,
    [startDate, endDate],
  );
  const a = agg[0] || {};
  const netRevenue = money((a.net_sales || 0) - (a.refunds || 0));
  return {
    type: 'sales_summary',
    title: 'Sales Summary',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    summary: {
      invoiceCount: a.invoice_count || 0,
      grossSales: money(a.gross_sales || 0),
      discounts: money(a.discounts || 0),
      netSales: money(a.net_sales || 0),
      vat: money(a.vat || 0),
      totalCollected: money(a.total_collected || 0),
      refunds: money(a.refunds || 0),
      netRevenue,
    },
    columns: [
      { key: 'method', label: 'Payment Method' },
      { key: 'payments', label: 'Payments', type: 'int', align: 'right' },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
      { key: 'share', label: 'Share %', type: 'percent', align: 'right' },
    ],
    rows: byMethod.map((r) => ({
      method: r.method,
      payments: r.payments,
      amount: money(r.amount),
      share:
        a.total_collected > 0
          ? Math.round((r.amount / a.total_collected) * 1000) / 10
          : 0,
    })),
    totals: {
      payments: byMethod.reduce((s, r) => s + r.payments, 0),
      amount: money(a.total_collected || 0),
      share: 100,
    },
  };
}

async function salesByPeriod(params) {
  const { startDate, endDate } = parseDateRange(params);
  const group = String(params.group_by || 'day').toLowerCase();
  const trunc =
    group === 'year' ? 'year' : group === 'month' ? 'month' : group === 'week' ? 'week' : 'day';
  const { rows } = await query(
    `SELECT date_trunc('${trunc}', confirmed_at)::date AS bucket,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(taxable_amount),0)::float8 AS net_sales,
            COALESCE(SUM(tax_amount),0)::float8 AS vat,
            COALESCE(SUM(total),0)::float8 AS total
       FROM invoices
      WHERE status = 'confirmed'
        AND confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY 1
      ORDER BY 1 ASC`,
    [startDate, endDate],
  );
  return {
    type: 'sales_by_period',
    title: `Sales by ${trunc}`,
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'bucket', label: trunc.charAt(0).toUpperCase() + trunc.slice(1), type: 'date' },
      { key: 'invoice_count', label: 'Invoices', type: 'int', align: 'right' },
      { key: 'net_sales', label: 'Net Sales', type: 'currency', align: 'right' },
      { key: 'vat', label: 'VAT', type: 'currency', align: 'right' },
      { key: 'total', label: 'Total', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      bucket: dateOnly(r.bucket),
      invoice_count: r.invoice_count,
      net_sales: money(r.net_sales),
      vat: money(r.vat),
      total: money(r.total),
    })),
    totals: {
      invoice_count: rows.reduce((s, r) => s + r.invoice_count, 0),
      net_sales: money(rows.reduce((s, r) => s + Number(r.net_sales), 0)),
      vat: money(rows.reduce((s, r) => s + Number(r.vat), 0)),
      total: money(rows.reduce((s, r) => s + Number(r.total), 0)),
    },
  };
}

async function salesByProduct(params) {
  const { startDate, endDate } = parseDateRange(params);
  const sort = String(params.sort || 'revenue').toLowerCase();
  const sortCol =
    sort === 'profit' ? 'profit' : sort === 'margin' ? 'margin' : sort === 'quantity' ? 'qty' : 'revenue';
  const { rows } = await query(
    `SELECT ii.product_id, ii.product_name, ii.sku,
            COALESCE(SUM(ii.quantity),0)::float8 AS qty,
            COALESCE(SUM(ii.line_total),0)::float8 AS revenue,
            COALESCE(SUM(ii.quantity * ii.cost_price_at_time),0)::float8 AS cost,
            COALESCE(SUM(ii.line_total - ii.quantity * ii.cost_price_at_time),0)::float8 AS profit
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY ii.product_id, ii.product_name, ii.sku
      ORDER BY ${sortCol} DESC
      LIMIT 500`,
    [startDate, endDate],
  );
  return {
    type: 'sales_by_product',
    title: 'Sales by Product',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'qty', label: 'Qty Sold', type: 'number', align: 'right' },
      { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
      { key: 'cost', label: 'Cost', type: 'currency', align: 'right' },
      { key: 'profit', label: 'Gross Profit', type: 'currency', align: 'right' },
      { key: 'margin', label: 'Margin %', type: 'percent', align: 'right' },
    ],
    rows: rows.map((r) => {
      const revenue = money(r.revenue);
      const cost = money(r.cost);
      const profit = money(r.profit);
      const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
      return {
        product_name: r.product_name,
        sku: r.sku || '',
        qty: Number(r.qty) || 0,
        revenue,
        cost,
        profit,
        margin,
      };
    }),
    totals: {
      qty: Number(rows.reduce((s, r) => s + Number(r.qty), 0).toFixed(2)),
      revenue: money(rows.reduce((s, r) => s + Number(r.revenue), 0)),
      cost: money(rows.reduce((s, r) => s + Number(r.cost), 0)),
      profit: money(rows.reduce((s, r) => s + Number(r.profit), 0)),
    },
  };
}

async function salesByCategory(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT pc.id AS category_id, pc.name AS category_name,
            COALESCE(SUM(ii.quantity),0)::float8 AS qty,
            COALESCE(SUM(ii.line_total),0)::float8 AS revenue
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY pc.id, pc.name
      ORDER BY revenue DESC`,
    [startDate, endDate],
  );
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return {
    type: 'sales_by_category',
    title: 'Sales by Category',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'category_name', label: 'Category' },
      { key: 'qty', label: 'Qty Sold', type: 'number', align: 'right' },
      { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
      { key: 'share', label: 'Share %', type: 'percent', align: 'right' },
    ],
    rows: rows.map((r) => ({
      category_name: r.category_name || 'Uncategorised',
      qty: Number(r.qty) || 0,
      revenue: money(r.revenue),
      share: total > 0 ? Math.round((r.revenue / total) * 1000) / 10 : 0,
    })),
    totals: {
      qty: Number(rows.reduce((s, r) => s + Number(r.qty), 0).toFixed(2)),
      revenue: money(total),
      share: 100,
    },
  };
}

async function salesByEmployee(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT u.id AS employee_id, u.username, e.name AS employee_name,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.total),0)::float8 AS revenue,
            COALESCE(SUM(i.discount_amount + i.invoice_discount),0)::float8 AS discounts,
            COALESCE(AVG(i.total),0)::float8 AS avg_invoice
       FROM invoices i
       LEFT JOIN users u ON u.id = i.confirmed_by
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
        AND i.confirmed_by IS NOT NULL
      GROUP BY u.id, u.username, e.name
      ORDER BY revenue DESC`,
    [startDate, endDate],
  );
  return {
    type: 'sales_by_employee',
    title: 'Sales by Employee',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'username', label: 'Username' },
      { key: 'invoice_count', label: 'Invoices', type: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
      { key: 'avg_invoice', label: 'Avg Invoice', type: 'currency', align: 'right' },
      { key: 'discounts', label: 'Discounts Given', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      employee_name: r.employee_name || r.username || 'Unknown',
      username: r.username,
      invoice_count: r.invoice_count,
      revenue: money(r.revenue),
      avg_invoice: money(r.avg_invoice),
      discounts: money(r.discounts),
    })),
    totals: {
      invoice_count: rows.reduce((s, r) => s + r.invoice_count, 0),
      revenue: money(rows.reduce((s, r) => s + Number(r.revenue), 0)),
      discounts: money(rows.reduce((s, r) => s + Number(r.discounts), 0)),
    },
  };
}

async function salesByPaymentMethod(params) {
  // Same shape as the summary's payment breakdown but exported as a full
  // report so it can be rendered/downloaded standalone.
  const summary = await salesSummary(params);
  return { ...summary, type: 'sales_by_payment_method', title: 'Sales by Payment Method' };
}

async function salesInvoices(params) {
  const { startDate, endDate } = parseDateRange(params);
  const status = params.status || null;
  const conds = [`i.confirmed_at::date BETWEEN $1::date AND $2::date`];
  const vals = [startDate, endDate];
  if (status) {
    conds.push(`i.status = $${vals.length + 1}`);
    vals.push(status);
  }
  const { rows } = await query(
    `SELECT i.id, i.invoice_number, i.status, i.payment_status,
            i.confirmed_at, i.total, i.balance_due,
            c.name AS customer_name, u.username AS confirmed_by_username
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u ON u.id = i.confirmed_by
      WHERE ${conds.join(' AND ')}
      ORDER BY i.confirmed_at DESC
      LIMIT 2000`,
    vals,
  );
  return {
    type: 'sales_invoices',
    title: 'Invoices',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'confirmed_at', label: 'Date', type: 'date' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'confirmed_by_username', label: 'Cashier' },
      { key: 'status', label: 'Status' },
      { key: 'payment_status', label: 'Payment' },
      { key: 'total', label: 'Total', type: 'currency', align: 'right' },
      { key: 'balance_due', label: 'Balance', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      invoice_number: r.invoice_number,
      confirmed_at: dateOnly(r.confirmed_at),
      customer_name: r.customer_name || 'Walk-in',
      confirmed_by_username: r.confirmed_by_username || '',
      status: r.status,
      payment_status: r.payment_status,
      total: money(r.total),
      balance_due: money(r.balance_due),
    })),
    totals: {
      total: money(rows.reduce((s, r) => s + Number(r.total), 0)),
      balance_due: money(rows.reduce((s, r) => s + Number(r.balance_due), 0)),
    },
  };
}

// =======================================================================
// Inventory reports
// =======================================================================
async function inventoryStockLevels(params) {
  const categoryId = params.category_id || null;
  const conds = ['p.is_active = true'];
  const vals = [];
  if (categoryId) {
    vals.push(categoryId);
    conds.push(`p.category_id = $${vals.length}`);
  }
  const { rows } = await query(
    `SELECT p.id AS product_id, p.name AS product_name, p.unit_label,
            pc.name AS category_name,
            COALESCE(SUM(pv.stock_qty),0)::float8 AS stock_qty,
            COALESCE(SUM(pv.stock_qty * pv.cost_price),0)::float8 AS cost_value,
            COALESCE(SUM(pv.stock_qty * pv.selling_price),0)::float8 AS potential_revenue,
            COALESCE(p.reorder_threshold,0)::float8 AS reorder_threshold
       FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
      WHERE ${conds.join(' AND ')}
      GROUP BY p.id, p.name, p.unit_label, pc.name, p.reorder_threshold
      ORDER BY p.name`,
    vals,
  );
  return {
    type: 'inventory_stock_levels',
    title: 'Stock Levels',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'category_name', label: 'Category' },
      { key: 'unit_label', label: 'Unit' },
      { key: 'stock_qty', label: 'On Hand', type: 'number', align: 'right' },
      { key: 'reorder_threshold', label: 'Reorder At', type: 'number', align: 'right' },
      { key: 'cost_value', label: 'Cost Value', type: 'currency', align: 'right' },
      { key: 'potential_revenue', label: 'Potential', type: 'currency', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((r) => ({
      product_name: r.product_name,
      category_name: r.category_name || '—',
      unit_label: r.unit_label,
      stock_qty: Number(r.stock_qty) || 0,
      reorder_threshold: Number(r.reorder_threshold) || 0,
      cost_value: money(r.cost_value),
      potential_revenue: money(r.potential_revenue),
      status:
        Number(r.stock_qty) <= 0
          ? 'out_of_stock'
          : Number(r.stock_qty) <= Number(r.reorder_threshold)
            ? 'low'
            : 'ok',
    })),
    totals: {
      cost_value: money(rows.reduce((s, r) => s + Number(r.cost_value), 0)),
      potential_revenue: money(rows.reduce((s, r) => s + Number(r.potential_revenue), 0)),
    },
  };
}

async function inventoryMovements(params) {
  const { startDate, endDate } = parseDateRange(params);
  const conds = ['sm.timestamp::date BETWEEN $1::date AND $2::date'];
  const vals = [startDate, endDate];
  if (params.product_id) {
    vals.push(params.product_id);
    conds.push(`sm.product_id = $${vals.length}`);
  }
  if (params.movement_type) {
    vals.push(params.movement_type);
    conds.push(`sm.movement_type = $${vals.length}`);
  }
  const { rows } = await query(
    `SELECT sm.timestamp, sm.movement_type, sm.quantity, sm.qty_before, sm.qty_after,
            sm.reference_type, sm.reference_id, sm.notes, sm.unit_label,
            p.name AS product_name, pv.sku, u.username AS employee
       FROM stock_movements sm
       LEFT JOIN products p ON p.id = sm.product_id
       LEFT JOIN product_variants pv ON pv.id = sm.variant_id
       LEFT JOIN users u ON u.id = sm.employee_id
      WHERE ${conds.join(' AND ')}
      ORDER BY sm.timestamp DESC
      LIMIT 5000`,
    vals,
  );
  return {
    type: 'inventory_movements',
    title: 'Stock Movements',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'timestamp', label: 'When', type: 'datetime' },
      { key: 'product_name', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'movement_type', label: 'Type' },
      { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
      { key: 'qty_after', label: 'After', type: 'number', align: 'right' },
      { key: 'employee', label: 'By' },
      { key: 'reference_type', label: 'Reference' },
    ],
    rows: rows.map((r) => ({
      timestamp: r.timestamp,
      product_name: r.product_name,
      sku: r.sku || '',
      movement_type: r.movement_type,
      quantity: Number(r.quantity),
      qty_after: Number(r.qty_after),
      employee: r.employee || '',
      reference_type: r.reference_type || '',
    })),
  };
}

async function inventoryValuation(params) {
  void params;
  const { rows } = await query(
    `SELECT COALESCE(pc.name, 'Uncategorised') AS category_name,
            COUNT(DISTINCT p.id)::int AS product_count,
            COALESCE(SUM(pv.stock_qty),0)::float8 AS units_on_hand,
            COALESCE(SUM(pv.stock_qty * pv.cost_price),0)::float8 AS cost_value,
            COALESCE(SUM(pv.stock_qty * pv.selling_price),0)::float8 AS potential_revenue
       FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY pc.name
      ORDER BY cost_value DESC`,
  );
  return {
    type: 'inventory_valuation',
    title: 'Inventory Valuation',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'category_name', label: 'Category' },
      { key: 'product_count', label: 'Products', type: 'int', align: 'right' },
      { key: 'units_on_hand', label: 'Units', type: 'number', align: 'right' },
      { key: 'cost_value', label: 'Cost Value', type: 'currency', align: 'right' },
      { key: 'potential_revenue', label: 'Potential Revenue', type: 'currency', align: 'right' },
      { key: 'potential_profit', label: 'Potential Profit', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      category_name: r.category_name,
      product_count: r.product_count,
      units_on_hand: Number(r.units_on_hand) || 0,
      cost_value: money(r.cost_value),
      potential_revenue: money(r.potential_revenue),
      potential_profit: money(Number(r.potential_revenue) - Number(r.cost_value)),
    })),
    totals: {
      product_count: rows.reduce((s, r) => s + r.product_count, 0),
      units_on_hand: Number(rows.reduce((s, r) => s + Number(r.units_on_hand), 0).toFixed(2)),
      cost_value: money(rows.reduce((s, r) => s + Number(r.cost_value), 0)),
      potential_revenue: money(rows.reduce((s, r) => s + Number(r.potential_revenue), 0)),
      potential_profit: money(
        rows.reduce(
          (s, r) => s + Number(r.potential_revenue) - Number(r.cost_value),
          0,
        ),
      ),
    },
  };
}

async function lowStock(_params) {
  const { rows } = await query(
    `SELECT p.id AS product_id, p.name AS product_name, p.unit_label,
            pc.name AS category_name,
            COALESCE(SUM(pv.stock_qty),0)::float8 AS stock_qty,
            COALESCE(p.reorder_threshold,0)::float8 AS reorder_threshold
       FROM products p
       LEFT JOIN product_categories pc ON pc.id = p.category_id
       LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = true
      WHERE p.is_active = true
      GROUP BY p.id, p.name, p.unit_label, pc.name, p.reorder_threshold
     HAVING COALESCE(SUM(pv.stock_qty),0) <= COALESCE(p.reorder_threshold,0)
        AND COALESCE(p.reorder_threshold,0) > 0
      ORDER BY (COALESCE(p.reorder_threshold,0) - COALESCE(SUM(pv.stock_qty),0)) DESC`,
  );
  return {
    type: 'low_stock',
    title: 'Low Stock Alerts',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'category_name', label: 'Category' },
      { key: 'stock_qty', label: 'On Hand', type: 'number', align: 'right' },
      { key: 'reorder_threshold', label: 'Threshold', type: 'number', align: 'right' },
      { key: 'shortfall', label: 'Shortfall', type: 'number', align: 'right' },
      { key: 'suggested_reorder', label: 'Suggested Reorder', type: 'number', align: 'right' },
    ],
    rows: rows.map((r) => {
      const stock = Number(r.stock_qty) || 0;
      const threshold = Number(r.reorder_threshold) || 0;
      // Suggest enough to refill to 2× the threshold so a single PO covers
      // shortfall + a comfortable buffer.
      const suggested = Math.max(threshold * 2 - stock, threshold - stock);
      return {
        product_name: r.product_name,
        category_name: r.category_name || '—',
        stock_qty: stock,
        reorder_threshold: threshold,
        shortfall: Math.max(0, threshold - stock),
        suggested_reorder: Math.round(suggested * 100) / 100,
      };
    }),
  };
}

async function deadStock(params) {
  const days = Math.max(1, Number(params.days) || 30);
  const { rows } = await query(
    `SELECT p.id AS product_id, p.name AS product_name, p.unit_label,
            COALESCE(SUM(pv.stock_qty),0)::float8 AS stock_qty,
            COALESCE(SUM(pv.stock_qty * pv.cost_price),0)::float8 AS cost_value,
            (SELECT MAX(i.confirmed_at) FROM invoice_items ii
               JOIN invoices i ON i.id = ii.invoice_id
              WHERE ii.product_id = p.id AND i.status = 'confirmed') AS last_sold_at
       FROM products p
       LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.is_active = true
      GROUP BY p.id, p.name, p.unit_label
     HAVING COALESCE(SUM(pv.stock_qty),0) > 0
        AND (
              (SELECT MAX(i.confirmed_at) FROM invoice_items ii
                 JOIN invoices i ON i.id = ii.invoice_id
                WHERE ii.product_id = p.id AND i.status = 'confirmed') IS NULL
              OR
              (SELECT MAX(i.confirmed_at) FROM invoice_items ii
                 JOIN invoices i ON i.id = ii.invoice_id
                WHERE ii.product_id = p.id AND i.status = 'confirmed')
              < NOW() - ($1 || ' days')::interval
            )
      ORDER BY cost_value DESC
      LIMIT 1000`,
    [days],
  );
  return {
    type: 'dead_stock',
    title: `Dead Stock (no sales in ${days} days)`,
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'stock_qty', label: 'On Hand', type: 'number', align: 'right' },
      { key: 'cost_value', label: 'Tied-up Value', type: 'currency', align: 'right' },
      { key: 'last_sold_at', label: 'Last Sold', type: 'date' },
    ],
    rows: rows.map((r) => ({
      product_name: r.product_name,
      stock_qty: Number(r.stock_qty) || 0,
      cost_value: money(r.cost_value),
      last_sold_at: dateOnly(r.last_sold_at),
    })),
    totals: {
      cost_value: money(rows.reduce((s, r) => s + Number(r.cost_value), 0)),
    },
  };
}

async function stockCounts(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT sc.id, sc.count_type, sc.status, sc.initiated_at, sc.approved_at,
            sc.total_products, sc.matched_count, sc.discrepancy_count,
            sc.net_value_impact,
            u.username AS initiated_by_username
       FROM stock_counts sc
       LEFT JOIN users u ON u.id = sc.initiated_by
      WHERE sc.initiated_at::date BETWEEN $1::date AND $2::date
      ORDER BY sc.initiated_at DESC`,
    [startDate, endDate],
  );
  return {
    type: 'inventory_stock_counts',
    title: 'Stock Counts',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'count_type', label: 'Type' },
      { key: 'initiated_at', label: 'Started', type: 'datetime' },
      { key: 'approved_at', label: 'Approved', type: 'datetime' },
      { key: 'status', label: 'Status' },
      { key: 'initiated_by_username', label: 'By' },
      { key: 'total_products', label: 'Products', type: 'int', align: 'right' },
      { key: 'discrepancy_count', label: 'Discrepancies', type: 'int', align: 'right' },
      { key: 'net_value_impact', label: 'Value Impact', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      count_type: r.count_type,
      initiated_at: r.initiated_at,
      approved_at: r.approved_at,
      status: r.status,
      initiated_by_username: r.initiated_by_username || '',
      total_products: r.total_products || 0,
      discrepancy_count: r.discrepancy_count || 0,
      net_value_impact: money(r.net_value_impact || 0),
    })),
  };
}

// =======================================================================
// Supplier reports
// =======================================================================
async function supplierSummary(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `WITH range AS (SELECT $1::date AS sd, $2::date AS ed)
     SELECT s.id, s.name, s.phone,
            (SELECT COUNT(*)::int FROM purchase_orders po
              WHERE po.supplier_id = s.id
                AND po.created_at::date BETWEEN (SELECT sd FROM range) AND (SELECT ed FROM range)) AS orders_count,
            (SELECT COALESCE(SUM(po.total_cost),0)::float8 FROM purchase_orders po
              WHERE po.supplier_id = s.id
                AND po.created_at::date BETWEEN (SELECT sd FROM range) AND (SELECT ed FROM range)) AS total_spent,
            (SELECT COALESCE(SUM(po.balance_due),0)::float8 FROM purchase_orders po
              WHERE po.supplier_id = s.id AND po.status <> 'cancelled') AS outstanding,
            (SELECT MAX(po.created_at) FROM purchase_orders po
              WHERE po.supplier_id = s.id) AS last_order,
            (SELECT COUNT(*)::int FROM supplier_returns sr WHERE sr.supplier_id = s.id) AS returns_count
       FROM suppliers s
      ORDER BY total_spent DESC NULLS LAST`,
    [startDate, endDate],
  );
  return {
    type: 'supplier_summary',
    title: 'Supplier Summary',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'name', label: 'Supplier' },
      { key: 'orders_count', label: 'Orders', type: 'int', align: 'right' },
      { key: 'total_spent', label: 'Spent', type: 'currency', align: 'right' },
      { key: 'outstanding', label: 'Outstanding', type: 'currency', align: 'right' },
      { key: 'last_order', label: 'Last Order', type: 'date' },
      { key: 'returns_count', label: 'Returns', type: 'int', align: 'right' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      orders_count: r.orders_count,
      total_spent: money(r.total_spent),
      outstanding: money(r.outstanding),
      last_order: dateOnly(r.last_order),
      returns_count: r.returns_count,
    })),
    totals: {
      orders_count: rows.reduce((s, r) => s + r.orders_count, 0),
      total_spent: money(rows.reduce((s, r) => s + Number(r.total_spent), 0)),
      outstanding: money(rows.reduce((s, r) => s + Number(r.outstanding), 0)),
    },
  };
}

async function supplierPayables(_params) {
  // Aging buckets keyed off due_date (falls back to created_at when due_date
  // wasn't set on the PO).
  const { rows } = await query(
    `SELECT s.id AS supplier_id, s.name AS supplier_name,
            COALESCE(SUM(CASE
              WHEN COALESCE(po.due_date, po.created_at::date) >= CURRENT_DATE THEN po.balance_due
              ELSE 0 END), 0)::float8 AS current_amount,
            COALESCE(SUM(CASE
              WHEN COALESCE(po.due_date, po.created_at::date) < CURRENT_DATE
               AND COALESCE(po.due_date, po.created_at::date) >= CURRENT_DATE - INTERVAL '30 days'
              THEN po.balance_due ELSE 0 END), 0)::float8 AS overdue_30,
            COALESCE(SUM(CASE
              WHEN COALESCE(po.due_date, po.created_at::date) < CURRENT_DATE - INTERVAL '30 days'
               AND COALESCE(po.due_date, po.created_at::date) >= CURRENT_DATE - INTERVAL '60 days'
              THEN po.balance_due ELSE 0 END), 0)::float8 AS overdue_60,
            COALESCE(SUM(CASE
              WHEN COALESCE(po.due_date, po.created_at::date) < CURRENT_DATE - INTERVAL '60 days'
              THEN po.balance_due ELSE 0 END), 0)::float8 AS overdue_90,
            COALESCE(SUM(po.balance_due),0)::float8 AS total
       FROM suppliers s
       JOIN purchase_orders po ON po.supplier_id = s.id
                              AND po.status <> 'cancelled'
                              AND po.balance_due > 0
      GROUP BY s.id, s.name
     HAVING COALESCE(SUM(po.balance_due),0) > 0
      ORDER BY total DESC`,
  );
  return {
    type: 'supplier_payables',
    title: 'Supplier Payables (Aging)',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'current_amount', label: 'Current', type: 'currency', align: 'right' },
      { key: 'overdue_30', label: '1–30 days', type: 'currency', align: 'right' },
      { key: 'overdue_60', label: '31–60 days', type: 'currency', align: 'right' },
      { key: 'overdue_90', label: '60+ days', type: 'currency', align: 'right' },
      { key: 'total', label: 'Total Due', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      supplier_name: r.supplier_name,
      current_amount: money(r.current_amount),
      overdue_30: money(r.overdue_30),
      overdue_60: money(r.overdue_60),
      overdue_90: money(r.overdue_90),
      total: money(r.total),
    })),
    totals: {
      current_amount: money(rows.reduce((s, r) => s + Number(r.current_amount), 0)),
      overdue_30: money(rows.reduce((s, r) => s + Number(r.overdue_30), 0)),
      overdue_60: money(rows.reduce((s, r) => s + Number(r.overdue_60), 0)),
      overdue_90: money(rows.reduce((s, r) => s + Number(r.overdue_90), 0)),
      total: money(rows.reduce((s, r) => s + Number(r.total), 0)),
    },
  };
}

async function supplierPurchases(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT po.po_number, po.created_at, po.status, po.total_cost, po.balance_due,
            s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.created_at::date BETWEEN $1::date AND $2::date
        AND po.status <> 'cancelled'
      ORDER BY po.created_at DESC`,
    [startDate, endDate],
  );
  return {
    type: 'supplier_purchases',
    title: 'Purchase History',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'po_number', label: 'PO #' },
      { key: 'created_at', label: 'Date', type: 'date' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'status', label: 'Status' },
      { key: 'total_cost', label: 'Total', type: 'currency', align: 'right' },
      { key: 'balance_due', label: 'Balance Due', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      po_number: r.po_number,
      created_at: dateOnly(r.created_at),
      supplier_name: r.supplier_name || '',
      status: r.status,
      total_cost: money(r.total_cost),
      balance_due: money(r.balance_due),
    })),
    totals: {
      total_cost: money(rows.reduce((s, r) => s + Number(r.total_cost), 0)),
      balance_due: money(rows.reduce((s, r) => s + Number(r.balance_due), 0)),
    },
  };
}

async function supplierPaymentsReport(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT sp.payment_date, sp.amount, sp.payment_method,
            s.name AS supplier_name, po.po_number, u.username AS paid_by_username
       FROM supplier_payments sp
       LEFT JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN purchase_orders po ON po.id = sp.purchase_order_id
       LEFT JOIN users u ON u.id = sp.employee_id
      WHERE sp.payment_date BETWEEN $1::date AND $2::date
      ORDER BY sp.payment_date DESC`,
    [startDate, endDate],
  );
  return {
    type: 'supplier_payments',
    title: 'Supplier Payments',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'payment_date', label: 'Date', type: 'date' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'po_number', label: 'PO #' },
      { key: 'payment_method', label: 'Method' },
      { key: 'paid_by_username', label: 'By' },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      payment_date: dateOnly(r.payment_date),
      supplier_name: r.supplier_name || '',
      po_number: r.po_number || '',
      payment_method: r.payment_method,
      paid_by_username: r.paid_by_username || '',
      amount: money(r.amount),
    })),
    totals: {
      amount: money(rows.reduce((s, r) => s + Number(r.amount), 0)),
    },
  };
}

async function supplierReturns(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT sr.return_number, sr.return_date, sr.reason, sr.status, sr.total_value,
            s.name AS supplier_name
       FROM supplier_returns sr
       LEFT JOIN suppliers s ON s.id = sr.supplier_id
      WHERE sr.return_date BETWEEN $1::date AND $2::date
      ORDER BY sr.return_date DESC`,
    [startDate, endDate],
  );
  return {
    type: 'supplier_returns',
    title: 'Supplier Returns',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'return_number', label: 'Return #' },
      { key: 'return_date', label: 'Date', type: 'date' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Status' },
      { key: 'total_value', label: 'Value', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      return_number: r.return_number,
      return_date: dateOnly(r.return_date),
      supplier_name: r.supplier_name || '',
      reason: r.reason,
      status: r.status,
      total_value: money(r.total_value),
    })),
    totals: {
      total_value: money(rows.reduce((s, r) => s + Number(r.total_value), 0)),
    },
  };
}

// =======================================================================
// Customer reports
// =======================================================================
async function customerSummary(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone, c.credit_balance,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.total),0)::float8 AS total_spent,
            COALESCE(AVG(i.total),0)::float8 AS avg_invoice,
            MAX(i.confirmed_at) AS last_purchase
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id
                           AND i.status = 'confirmed'
                           AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY c.id
      ORDER BY total_spent DESC NULLS LAST
      LIMIT 1000`,
    [startDate, endDate],
  );
  return {
    type: 'customer_summary',
    title: 'Customer Summary',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'invoice_count', label: 'Invoices', type: 'int', align: 'right' },
      { key: 'total_spent', label: 'Total Spent', type: 'currency', align: 'right' },
      { key: 'avg_invoice', label: 'Avg Invoice', type: 'currency', align: 'right' },
      { key: 'credit_balance', label: 'Credit Balance', type: 'currency', align: 'right' },
      { key: 'last_purchase', label: 'Last Purchase', type: 'date' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      phone: r.phone || '',
      invoice_count: r.invoice_count,
      total_spent: money(r.total_spent),
      avg_invoice: money(r.avg_invoice),
      credit_balance: money(r.credit_balance),
      last_purchase: dateOnly(r.last_purchase),
    })),
    totals: {
      invoice_count: rows.reduce((s, r) => s + r.invoice_count, 0),
      total_spent: money(rows.reduce((s, r) => s + Number(r.total_spent), 0)),
      credit_balance: money(rows.reduce((s, r) => s + Number(r.credit_balance), 0)),
    },
  };
}

async function customerReceivables(_params) {
  // Aging keyed off invoice confirmed_at for the customer's open balance.
  // We approximate per-customer aging using the *oldest* unpaid invoice and
  // the total credit_balance — fine for the report layer.
  const { rows } = await query(
    `WITH c AS (
       SELECT c.id, c.name, c.phone, c.credit_balance,
              (SELECT MIN(confirmed_at)
                 FROM invoices i
                WHERE i.customer_id = c.id
                  AND i.status = 'confirmed'
                  AND i.balance_due > 0) AS oldest_open
         FROM customers c
        WHERE c.credit_balance > 0
     )
     SELECT *,
            CASE
              WHEN oldest_open IS NULL OR oldest_open::date >= CURRENT_DATE THEN 'current'
              WHEN oldest_open::date >= CURRENT_DATE - INTERVAL '30 days' THEN '1_30'
              WHEN oldest_open::date >= CURRENT_DATE - INTERVAL '60 days' THEN '31_60'
              ELSE 'over_60'
            END AS bucket
       FROM c
      ORDER BY credit_balance DESC`,
  );
  function bucketAmt(row, bucket) {
    return row.bucket === bucket ? money(row.credit_balance) : 0;
  }
  return {
    type: 'customer_receivables',
    title: 'Customer Receivables (Aging)',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'current_amount', label: 'Current', type: 'currency', align: 'right' },
      { key: 'overdue_30', label: '1–30 days', type: 'currency', align: 'right' },
      { key: 'overdue_60', label: '31–60 days', type: 'currency', align: 'right' },
      { key: 'overdue_90', label: '60+ days', type: 'currency', align: 'right' },
      { key: 'total', label: 'Total Due', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      phone: r.phone || '',
      current_amount: bucketAmt(r, 'current'),
      overdue_30: bucketAmt(r, '1_30'),
      overdue_60: bucketAmt(r, '31_60'),
      overdue_90: bucketAmt(r, 'over_60'),
      total: money(r.credit_balance),
    })),
    totals: {
      total: money(rows.reduce((s, r) => s + Number(r.credit_balance), 0)),
    },
  };
}

async function customerPayments(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT cp.payment_date, cp.amount, cp.payment_method, cp.notes,
            c.name AS customer_name, u.username AS collected_by_username
       FROM customer_payments cp
       LEFT JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN users u ON u.id = cp.employee_id
      WHERE cp.payment_date BETWEEN $1::date AND $2::date
      ORDER BY cp.payment_date DESC`,
    [startDate, endDate],
  );
  return {
    type: 'customer_payments',
    title: 'Customer Payments',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'payment_date', label: 'Date', type: 'date' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'payment_method', label: 'Method' },
      { key: 'collected_by_username', label: 'By' },
      { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      payment_date: dateOnly(r.payment_date),
      customer_name: r.customer_name || '',
      payment_method: r.payment_method,
      collected_by_username: r.collected_by_username || '',
      amount: money(r.amount),
    })),
    totals: {
      amount: money(rows.reduce((s, r) => s + Number(r.amount), 0)),
    },
  };
}

async function customerTop(params) {
  const { startDate, endDate } = parseDateRange(params);
  const limit = Math.min(Number(params.limit) || 20, 100);
  const sort = params.sort === 'frequency' ? 'invoice_count' : 'total_spent';
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.total),0)::float8 AS total_spent
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY c.id
      ORDER BY ${sort} DESC
      LIMIT $3`,
    [startDate, endDate, limit],
  );
  return {
    type: 'customer_top',
    title: 'Top Customers',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'rank', label: '#', type: 'int', align: 'right' },
      { key: 'name', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'invoice_count', label: 'Invoices', type: 'int', align: 'right' },
      { key: 'total_spent', label: 'Spent', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      phone: r.phone || '',
      invoice_count: r.invoice_count,
      total_spent: money(r.total_spent),
    })),
  };
}

async function customerInactive(params) {
  const days = Math.max(1, Number(params.days) || 60);
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone, c.credit_balance,
            MAX(i.confirmed_at) AS last_purchase,
            COUNT(i.id)::int AS total_invoices
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'confirmed'
      WHERE c.is_active = true
      GROUP BY c.id
     HAVING MAX(i.confirmed_at) IS NULL
         OR MAX(i.confirmed_at) < NOW() - ($1 || ' days')::interval
      ORDER BY last_purchase NULLS LAST`,
    [days],
  );
  return {
    type: 'customer_inactive',
    title: `Inactive Customers (no purchase in ${days} days)`,
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'total_invoices', label: 'Total Invoices', type: 'int', align: 'right' },
      { key: 'credit_balance', label: 'Credit Balance', type: 'currency', align: 'right' },
      { key: 'last_purchase', label: 'Last Purchase', type: 'date' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      phone: r.phone || '',
      total_invoices: r.total_invoices,
      credit_balance: money(r.credit_balance),
      last_purchase: dateOnly(r.last_purchase),
    })),
  };
}

// =======================================================================
// Employee reports
// =======================================================================
async function employeePerformance(params) {
  const { startDate, endDate } = parseDateRange(params);
  const employeeId = params.employee_id || null;
  const conds = ['i.status = $1', "i.confirmed_at::date BETWEEN $2::date AND $3::date"];
  const vals = ['confirmed', startDate, endDate];
  // Scope to a single user when the cashier opens their own view.
  if (employeeId) {
    vals.push(employeeId);
    conds.push(`u.id = $${vals.length}`);
  }
  const { rows } = await query(
    `SELECT u.id AS user_id, u.username, e.name AS employee_name,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.total),0)::float8 AS revenue,
            COALESCE(AVG(i.total),0)::float8 AS avg_invoice,
            COALESCE(SUM(i.discount_amount + i.invoice_discount),0)::float8 AS discounts,
            (SELECT COUNT(*)::int FROM return_orders ro
              WHERE ro.employee_id = u.id
                AND ro.created_at::date BETWEEN $2::date AND $3::date) AS returns,
            (SELECT COALESCE(SUM(cp.amount),0)::float8 FROM customer_payments cp
              WHERE cp.employee_id = u.id
                AND cp.payment_date BETWEEN $2::date AND $3::date) AS collections
       FROM invoices i
       JOIN users u ON u.id = i.confirmed_by
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE ${conds.join(' AND ')}
      GROUP BY u.id, u.username, e.name
      ORDER BY revenue DESC`,
    vals,
  );
  return {
    type: 'employee_performance',
    title: 'Employee Performance',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'invoice_count', label: 'Invoices', type: 'int', align: 'right' },
      { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
      { key: 'avg_invoice', label: 'Avg Invoice', type: 'currency', align: 'right' },
      { key: 'discounts', label: 'Discounts', type: 'currency', align: 'right' },
      { key: 'collections', label: 'Collections', type: 'currency', align: 'right' },
      { key: 'returns', label: 'Returns', type: 'int', align: 'right' },
    ],
    rows: rows.map((r) => ({
      employee_name: r.employee_name || r.username,
      invoice_count: r.invoice_count,
      revenue: money(r.revenue),
      avg_invoice: money(r.avg_invoice),
      discounts: money(r.discounts),
      collections: money(r.collections),
      returns: r.returns,
    })),
  };
}

async function employeeActivity(params) {
  const { startDate, endDate } = parseDateRange(params);
  const employeeId = params.employee_id || null;
  const conds = ['al.timestamp::date BETWEEN $1::date AND $2::date'];
  const vals = [startDate, endDate];
  if (employeeId) {
    vals.push(employeeId);
    conds.push(`al.performed_by = $${vals.length}`);
  }
  const { rows } = await query(
    `SELECT al.timestamp, al.entity_type, al.action, al.entity_id, al.notes,
            u.username, e.name AS employee_name
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.performed_by
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE ${conds.join(' AND ')}
      ORDER BY al.timestamp DESC
      LIMIT 5000`,
    vals,
  );
  return {
    type: 'employee_activity',
    title: 'Employee Activity Log',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'timestamp', label: 'When', type: 'datetime' },
      { key: 'employee_name', label: 'Employee' },
      { key: 'action', label: 'Action' },
      { key: 'entity_type', label: 'Entity' },
      { key: 'notes', label: 'Notes' },
    ],
    rows: rows.map((r) => ({
      timestamp: r.timestamp,
      employee_name: r.employee_name || r.username || '—',
      action: r.action,
      entity_type: r.entity_type || '',
      notes: r.notes || '',
    })),
  };
}

async function payroll(params) {
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const daysInMonth = Number(monthEnd.slice(8));

  const { rows } = await query(
    `SELECT e.id, e.name, e.role_title, e.base_salary, e.salary_type,
            e.standard_hours, e.shift_start, e.shift_end,
            (SELECT COUNT(*)::int FROM attendance a
              WHERE a.employee_id = e.id
                AND a.date BETWEEN $1::date AND $2::date
                AND a.status IN ('present','late','half_day')) AS days_worked,
            (SELECT COALESCE(SUM(a.working_hours),0)::float8 FROM attendance a
              WHERE a.employee_id = e.id
                AND a.date BETWEEN $1::date AND $2::date) AS hours_worked,
            (SELECT COALESCE(SUM(a.overtime_hours),0)::float8 FROM attendance a
              WHERE a.employee_id = e.id
                AND a.date BETWEEN $1::date AND $2::date) AS overtime_hours,
            (SELECT COUNT(*)::int FROM attendance a
              WHERE a.employee_id = e.id
                AND a.date BETWEEN $1::date AND $2::date
                AND a.status = 'absent') AS days_absent,
            (SELECT COALESCE(SUM(l.total_days),0)::int FROM leaves l
              WHERE l.employee_id = e.id AND l.status = 'approved'
                AND l.leave_type = 'unpaid'
                AND l.start_date <= $2::date AND l.end_date >= $1::date) AS unpaid_leave_days
       FROM employees e
      WHERE e.is_active = true
      ORDER BY e.name`,
    [monthStart, monthEnd],
  );

  function computePay(emp) {
    const base = Number(emp.base_salary) || 0;
    const type = emp.salary_type || 'monthly';
    const daysWorked = Number(emp.days_worked) || 0;
    const hours = Number(emp.hours_worked) || 0;
    const overtime = Number(emp.overtime_hours) || 0;
    const unpaid = Number(emp.unpaid_leave_days) || 0;

    let gross;
    if (type === 'daily') gross = base * daysWorked;
    else if (type === 'hourly') gross = base * hours;
    else gross = base;

    // Per-day rate used for unpaid-leave + absence deductions on monthly.
    const dayRate = type === 'monthly' && daysInMonth > 0 ? base / daysInMonth : base;
    const deductions = type === 'monthly' ? money(dayRate * unpaid) : 0;

    // Overtime at 1.5× hourly rate. Hourly rate inferred from standard hours
    // and the salary type.
    const hourRate =
      type === 'hourly'
        ? base
        : type === 'daily'
          ? base / (Number(emp.standard_hours) || 8)
          : dayRate / (Number(emp.standard_hours) || 8);
    const overtimePay = money(overtime * hourRate * 1.5);

    const net = money(gross - deductions + overtimePay);
    return { gross: money(gross), deductions, overtimePay, net };
  }

  return {
    type: 'payroll',
    title: `Payroll — ${year}-${String(month).padStart(2, '0')}`,
    period: { startDate: monthStart, endDate: monthEnd, label: `${monthStart} – ${monthEnd}` },
    columns: [
      { key: 'name', label: 'Employee' },
      { key: 'role_title', label: 'Role' },
      { key: 'salary_type', label: 'Type' },
      { key: 'days_worked', label: 'Days', type: 'int', align: 'right' },
      { key: 'hours_worked', label: 'Hours', type: 'number', align: 'right' },
      { key: 'overtime_hours', label: 'OT Hrs', type: 'number', align: 'right' },
      { key: 'gross', label: 'Gross', type: 'currency', align: 'right' },
      { key: 'deductions', label: 'Deductions', type: 'currency', align: 'right' },
      { key: 'overtime_pay', label: 'Overtime Pay', type: 'currency', align: 'right' },
      { key: 'net', label: 'Net Salary', type: 'currency', align: 'right' },
    ],
    rows: rows.map((emp) => {
      const calc = computePay(emp);
      return {
        name: emp.name,
        role_title: emp.role_title || '',
        salary_type: emp.salary_type || 'monthly',
        days_worked: emp.days_worked,
        hours_worked: Number(emp.hours_worked) || 0,
        overtime_hours: Number(emp.overtime_hours) || 0,
        gross: calc.gross,
        deductions: calc.deductions,
        overtime_pay: calc.overtimePay,
        net: calc.net,
      };
    }),
    totals: {
      gross: money(
        rows.reduce((s, r) => s + computePay(r).gross, 0),
      ),
      deductions: money(
        rows.reduce((s, r) => s + computePay(r).deductions, 0),
      ),
      overtime_pay: money(
        rows.reduce((s, r) => s + computePay(r).overtimePay, 0),
      ),
      net: money(rows.reduce((s, r) => s + computePay(r).net, 0)),
    },
  };
}

// =======================================================================
// Attendance reports
// =======================================================================
async function attendanceMonthlySheet(params) {
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const month = Number(params.month) || now.getMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const daysInMonth = Number(monthEnd.slice(8));

  const { rows: employees } = await query(
    `SELECT id, name, role_title FROM employees WHERE is_active = true ORDER BY name`,
  );
  const { rows: attRows } = await query(
    `SELECT employee_id, date, status, working_hours, late_minutes
       FROM attendance
      WHERE date BETWEEN $1::date AND $2::date`,
    [monthStart, monthEnd],
  );
  const byEmp = new Map();
  for (const a of attRows) {
    const day = Number(dateOnly(a.date).slice(8));
    let row = byEmp.get(a.employee_id);
    if (!row) {
      row = { days: {}, summary: { present: 0, absent: 0, late: 0, leave: 0, hours: 0 } };
      byEmp.set(a.employee_id, row);
    }
    row.days[day] = a.status;
    row.summary[a.status] = (row.summary[a.status] || 0) + 1;
    if (a.status === 'present' || a.status === 'late') {
      row.summary.hours += Number(a.working_hours) || 0;
    }
  }

  const days = [];
  for (let i = 1; i <= daysInMonth; i += 1) days.push(i);

  const columns = [
    { key: 'name', label: 'Employee', sticky: true },
    ...days.map((d) => ({ key: `d${d}`, label: String(d), type: 'attendance', align: 'center' })),
    { key: 'present_days', label: 'P', type: 'int', align: 'right' },
    { key: 'absent_days', label: 'A', type: 'int', align: 'right' },
    { key: 'late_days', label: 'L', type: 'int', align: 'right' },
    { key: 'leave_days', label: 'Lv', type: 'int', align: 'right' },
    { key: 'hours_total', label: 'Hrs', type: 'number', align: 'right' },
  ];
  const rows = employees.map((e) => {
    const data = byEmp.get(e.id) || { days: {}, summary: {} };
    const out = { name: e.name };
    days.forEach((d) => {
      out[`d${d}`] = data.days[d] || null;
    });
    out.present_days = data.summary.present || 0;
    out.absent_days = data.summary.absent || 0;
    out.late_days = data.summary.late || 0;
    out.leave_days = data.summary.leave || 0;
    out.hours_total = Math.round((data.summary.hours || 0) * 100) / 100;
    return out;
  });

  return {
    type: 'attendance_monthly_sheet',
    title: `Attendance Sheet — ${year}-${String(month).padStart(2, '0')}`,
    period: { startDate: monthStart, endDate: monthEnd, label: `${monthStart} – ${monthEnd}` },
    columns,
    rows,
    grid: true,
    days,
  };
}

async function attendanceSummary(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT e.id, e.name, e.role_title,
            COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
            COUNT(*) FILTER (WHERE a.status = 'late')::int AS late,
            COUNT(*) FILTER (WHERE a.status = 'leave')::int AS leave,
            COALESCE(SUM(a.working_hours),0)::float8 AS hours,
            COALESCE(SUM(a.overtime_hours),0)::float8 AS overtime
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id
                             AND a.date BETWEEN $1::date AND $2::date
      WHERE e.is_active = true
      GROUP BY e.id, e.name, e.role_title
      ORDER BY e.name`,
    [startDate, endDate],
  );
  return {
    type: 'attendance_summary',
    title: 'Attendance Summary',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'name', label: 'Employee' },
      { key: 'role_title', label: 'Role' },
      { key: 'present', label: 'Present', type: 'int', align: 'right' },
      { key: 'absent', label: 'Absent', type: 'int', align: 'right' },
      { key: 'late', label: 'Late', type: 'int', align: 'right' },
      { key: 'leave', label: 'Leave', type: 'int', align: 'right' },
      { key: 'hours', label: 'Hours', type: 'number', align: 'right' },
      { key: 'overtime', label: 'Overtime', type: 'number', align: 'right' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      role_title: r.role_title || '',
      present: r.present,
      absent: r.absent,
      late: r.late,
      leave: r.leave,
      hours: Math.round(Number(r.hours) * 100) / 100,
      overtime: Math.round(Number(r.overtime) * 100) / 100,
    })),
  };
}

async function attendanceLate(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT e.name AS employee_name, e.role_title,
            COUNT(*)::int AS late_days,
            COALESCE(AVG(a.late_minutes),0)::float8 AS avg_late_mins,
            COALESCE(SUM(a.late_minutes),0)::int AS total_late_mins
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.status = 'late'
        AND a.date BETWEEN $1::date AND $2::date
      GROUP BY e.id, e.name, e.role_title
      ORDER BY total_late_mins DESC`,
    [startDate, endDate],
  );
  return {
    type: 'attendance_late',
    title: 'Late Attendance',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'role_title', label: 'Role' },
      { key: 'late_days', label: 'Late Days', type: 'int', align: 'right' },
      { key: 'avg_late_mins', label: 'Avg Late (mins)', type: 'number', align: 'right' },
      { key: 'total_late_mins', label: 'Total Late (mins)', type: 'int', align: 'right' },
    ],
    rows: rows.map((r) => ({
      employee_name: r.employee_name,
      role_title: r.role_title || '',
      late_days: r.late_days,
      avg_late_mins: Math.round(Number(r.avg_late_mins) * 10) / 10,
      total_late_mins: r.total_late_mins,
    })),
  };
}

async function attendanceLeave(params) {
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  const { rows: bal } = await query(
    `SELECT e.id, e.name,
            COALESCE(SUM(lb.entitled_days),0)::int AS entitled,
            COALESCE(SUM(lb.used_days),0)::int AS used,
            COALESCE(SUM(lb.remaining_days),0)::int AS remaining
       FROM employees e
       LEFT JOIN leave_balances lb ON lb.employee_id = e.id AND lb.year = $1
      WHERE e.is_active = true
      GROUP BY e.id, e.name
      ORDER BY e.name`,
    [year],
  );
  return {
    type: 'attendance_leave',
    title: `Leave Balances — ${year}`,
    period: { label: `Year ${year}` },
    columns: [
      { key: 'name', label: 'Employee' },
      { key: 'entitled', label: 'Entitled', type: 'int', align: 'right' },
      { key: 'used', label: 'Used', type: 'int', align: 'right' },
      { key: 'remaining', label: 'Remaining', type: 'int', align: 'right' },
    ],
    rows: bal.map((r) => ({
      name: r.name,
      entitled: r.entitled,
      used: r.used,
      remaining: r.remaining,
    })),
  };
}

async function attendanceOvertime(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT e.name AS employee_name, e.base_salary, e.salary_type, e.standard_hours,
            COALESCE(SUM(a.overtime_hours),0)::float8 AS overtime_hours
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.overtime_hours > 0
      GROUP BY e.id, e.name, e.base_salary, e.salary_type, e.standard_hours
      ORDER BY overtime_hours DESC`,
    [startDate, endDate],
  );
  return {
    type: 'attendance_overtime',
    title: 'Overtime',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'employee_name', label: 'Employee' },
      { key: 'overtime_hours', label: 'OT Hours', type: 'number', align: 'right' },
      { key: 'overtime_cost', label: 'OT Cost', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => {
      const base = Number(r.base_salary) || 0;
      const type = r.salary_type || 'monthly';
      const std = Number(r.standard_hours) || 8;
      const hourRate =
        type === 'hourly'
          ? base
          : type === 'daily'
            ? base / std
            : base / 30 / std;
      return {
        employee_name: r.employee_name,
        overtime_hours: Math.round(Number(r.overtime_hours) * 100) / 100,
        overtime_cost: money(Number(r.overtime_hours) * hourRate * 1.5),
      };
    }),
  };
}

// =======================================================================
// Warranty reports
// =======================================================================
async function warrantyActive(_params) {
  const { rows } = await query(
    `SELECT w.warranty_number, w.start_date, w.end_date, w.duration_months,
            p.name AS product_name, w.serial_number,
            c.name AS customer_name, c.phone AS customer_phone,
            (w.end_date - CURRENT_DATE)::int AS days_left
       FROM warranties w
       LEFT JOIN products p ON p.id = w.product_id
       LEFT JOIN customers c ON c.id = w.customer_id
      WHERE w.status = 'active'
      ORDER BY w.end_date ASC`,
  );
  return {
    type: 'warranty_active',
    title: 'Active Warranties',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'warranty_number', label: 'Warranty #' },
      { key: 'product_name', label: 'Product' },
      { key: 'serial_number', label: 'Serial' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'start_date', label: 'Start', type: 'date' },
      { key: 'end_date', label: 'End', type: 'date' },
      { key: 'days_left', label: 'Days Left', type: 'int', align: 'right' },
    ],
    rows: rows.map((r) => ({
      warranty_number: r.warranty_number,
      product_name: r.product_name || '',
      serial_number: r.serial_number || '',
      customer_name: r.customer_name || '',
      start_date: dateOnly(r.start_date),
      end_date: dateOnly(r.end_date),
      days_left: r.days_left,
    })),
  };
}

async function warrantyClaims(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT wc.claim_number, wc.claim_date, wc.status, wc.resolution,
            w.warranty_number, p.name AS product_name, c.name AS customer_name
       FROM warranty_claims wc
       LEFT JOIN warranties w ON w.id = wc.warranty_id
       LEFT JOIN products p ON p.id = w.product_id
       LEFT JOIN customers c ON c.id = wc.customer_id
      WHERE wc.claim_date BETWEEN $1::date AND $2::date
      ORDER BY wc.claim_date DESC`,
    [startDate, endDate],
  );
  return {
    type: 'warranty_claims',
    title: 'Warranty Claims',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'claim_number', label: 'Claim #' },
      { key: 'claim_date', label: 'Date', type: 'date' },
      { key: 'warranty_number', label: 'Warranty #' },
      { key: 'product_name', label: 'Product' },
      { key: 'customer_name', label: 'Customer' },
      { key: 'resolution', label: 'Resolution' },
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((r) => ({
      claim_number: r.claim_number,
      claim_date: dateOnly(r.claim_date),
      warranty_number: r.warranty_number || '',
      product_name: r.product_name || '',
      customer_name: r.customer_name || '',
      resolution: r.resolution || '—',
      status: r.status,
    })),
  };
}

async function warrantyByProduct(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT p.id AS product_id, p.name AS product_name,
            COUNT(DISTINCT w.id)::int AS warranties,
            COUNT(DISTINCT wc.id)::int AS claims,
            CASE WHEN COUNT(DISTINCT w.id) > 0
                 THEN (COUNT(DISTINCT wc.id)::float8 / COUNT(DISTINCT w.id) * 100)
                 ELSE 0 END AS claim_rate
       FROM products p
       LEFT JOIN warranties w ON w.product_id = p.id
                             AND w.created_at::date BETWEEN $1::date AND $2::date
       LEFT JOIN warranty_claims wc ON wc.warranty_id = w.id
      GROUP BY p.id, p.name
     HAVING COUNT(DISTINCT w.id) > 0
      ORDER BY claim_rate DESC`,
    [startDate, endDate],
  );
  return {
    type: 'warranty_by_product',
    title: 'Warranty Claim Rate by Product',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'warranties', label: 'Warranties', type: 'int', align: 'right' },
      { key: 'claims', label: 'Claims', type: 'int', align: 'right' },
      { key: 'claim_rate', label: 'Claim Rate %', type: 'percent', align: 'right' },
    ],
    rows: rows.map((r) => ({
      product_name: r.product_name,
      warranties: r.warranties,
      claims: r.claims,
      claim_rate: Math.round(Number(r.claim_rate) * 10) / 10,
    })),
  };
}

// =======================================================================
// Returns reports
// =======================================================================
async function returnsSummary(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows: groups } = await query(
    `SELECT return_type,
            COUNT(*)::int AS count,
            COALESCE(SUM(total_value),0)::float8 AS total_value,
            COALESCE(SUM(refund_total),0)::float8 AS refund_total
       FROM return_orders
      WHERE created_at::date BETWEEN $1::date AND $2::date
      GROUP BY return_type
      ORDER BY count DESC`,
    [startDate, endDate],
  );
  const { rows: salesAgg } = await query(
    `SELECT COALESCE(SUM(total),0)::float8 AS revenue
       FROM invoices
      WHERE status = 'confirmed' AND confirmed_at::date BETWEEN $1::date AND $2::date`,
    [startDate, endDate],
  );
  const revenue = Number(salesAgg[0]?.revenue || 0);
  const returnTotal = groups.reduce((s, r) => s + Number(r.total_value), 0);
  const refundTotal = groups.reduce((s, r) => s + Number(r.refund_total), 0);
  return {
    type: 'returns_summary',
    title: 'Returns Summary',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    summary: {
      totalReturns: groups.reduce((s, r) => s + r.count, 0),
      totalValue: money(returnTotal),
      refundsPaid: money(refundTotal),
      returnRatePct:
        revenue > 0 ? Math.round((returnTotal / revenue) * 1000) / 10 : 0,
    },
    columns: [
      { key: 'return_type', label: 'Type' },
      { key: 'count', label: 'Count', type: 'int', align: 'right' },
      { key: 'total_value', label: 'Value', type: 'currency', align: 'right' },
      { key: 'refund_total', label: 'Refunds', type: 'currency', align: 'right' },
    ],
    rows: groups.map((r) => ({
      return_type: r.return_type,
      count: r.count,
      total_value: money(r.total_value),
      refund_total: money(r.refund_total),
    })),
    totals: {
      count: groups.reduce((s, r) => s + r.count, 0),
      total_value: money(returnTotal),
      refund_total: money(refundTotal),
    },
  };
}

async function returnsRequests(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT rr.request_number, rr.requested_at, rr.return_type, rr.reason, rr.status,
            rr.reviewed_at, rr.rejection_reason,
            c.name AS customer_name, s.name AS supplier_name,
            EXTRACT(EPOCH FROM (COALESCE(rr.reviewed_at, NOW()) - rr.requested_at)) / 3600 AS hours_to_review
       FROM return_requests rr
       LEFT JOIN customers c ON c.id = rr.customer_id
       LEFT JOIN suppliers s ON s.id = rr.supplier_id
      WHERE rr.requested_at::date BETWEEN $1::date AND $2::date
      ORDER BY rr.requested_at DESC`,
    [startDate, endDate],
  );
  return {
    type: 'returns_requests',
    title: 'Return Requests',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'request_number', label: 'Request #' },
      { key: 'requested_at', label: 'Requested', type: 'date' },
      { key: 'return_type', label: 'Type' },
      { key: 'counterparty', label: 'Counterparty' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Status' },
      { key: 'hours_to_review', label: 'Hours to Review', type: 'number', align: 'right' },
    ],
    rows: rows.map((r) => ({
      request_number: r.request_number,
      requested_at: dateOnly(r.requested_at),
      return_type: r.return_type,
      counterparty: r.customer_name || r.supplier_name || '—',
      reason: r.reason,
      status: r.status,
      hours_to_review: Math.round(Number(r.hours_to_review || 0) * 10) / 10,
    })),
  };
}

async function returnsByProduct(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows } = await query(
    `SELECT roi.product_id, roi.product_name,
            COUNT(*)::int AS return_count,
            COALESCE(SUM(roi.quantity),0)::float8 AS qty_returned,
            COALESCE(SUM(roi.total_value),0)::float8 AS value_returned
       FROM return_order_items roi
       JOIN return_orders ro ON ro.id = roi.return_order_id
      WHERE ro.created_at::date BETWEEN $1::date AND $2::date
      GROUP BY roi.product_id, roi.product_name
      ORDER BY value_returned DESC
      LIMIT 200`,
    [startDate, endDate],
  );
  return {
    type: 'returns_by_product',
    title: 'Most Returned Products',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'return_count', label: 'Times Returned', type: 'int', align: 'right' },
      { key: 'qty_returned', label: 'Qty', type: 'number', align: 'right' },
      { key: 'value_returned', label: 'Value', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      product_name: r.product_name,
      return_count: r.return_count,
      qty_returned: Number(r.qty_returned),
      value_returned: money(r.value_returned),
    })),
    totals: {
      return_count: rows.reduce((s, r) => s + r.return_count, 0),
      value_returned: money(rows.reduce((s, r) => s + Number(r.value_returned), 0)),
    },
  };
}

// =======================================================================
// Bills reports
// =======================================================================
async function billsSummary(_params) {
  const { rows: byStatus } = await query(
    `SELECT bp.status,
            COUNT(*)::int AS count,
            COALESCE(SUM(COALESCE(bp.amount_paid, bp.amount_due)),0)::float8 AS amount
       FROM bill_payments bp
      GROUP BY bp.status`,
  );
  const { rows: byCategory } = await query(
    `SELECT COALESCE(ec.name, 'Uncategorised') AS category_name,
            COUNT(DISTINCT b.id)::int AS bills,
            COALESCE(SUM(bp.amount_paid),0)::float8 AS paid
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
       LEFT JOIN expense_categories ec ON ec.id = b.category_id
      WHERE bp.status = 'paid'
      GROUP BY ec.name
      ORDER BY paid DESC`,
  );
  const idx = Object.fromEntries(byStatus.map((r) => [r.status, r]));
  return {
    type: 'bills_summary',
    title: 'Bills Summary',
    period: { label: `As of ${todayIso()}` },
    summary: {
      paidCount: idx.paid?.count || 0,
      paidAmount: money(idx.paid?.amount || 0),
      dueCount: idx.due?.count || 0,
      dueAmount: money(idx.due?.amount || 0),
      overdueCount: idx.overdue?.count || 0,
      overdueAmount: money(idx.overdue?.amount || 0),
      upcomingCount: idx.upcoming?.count || 0,
      upcomingAmount: money(idx.upcoming?.amount || 0),
    },
    columns: [
      { key: 'category_name', label: 'Category' },
      { key: 'bills', label: 'Bills', type: 'int', align: 'right' },
      { key: 'paid', label: 'Total Paid', type: 'currency', align: 'right' },
    ],
    rows: byCategory.map((r) => ({
      category_name: r.category_name,
      bills: r.bills,
      paid: money(r.paid),
    })),
    totals: {
      paid: money(byCategory.reduce((s, r) => s + Number(r.paid), 0)),
    },
  };
}

async function billsExpenses(params) {
  const { startDate, endDate } = parseDateRange(params);
  const { rows: cat } = await query(
    `WITH agg AS (
       SELECT COALESCE(ec.name, 'Uncategorised') AS category_name,
              COALESCE(SUM(amount),0)::float8 AS total
         FROM (
           SELECT bp.amount_paid AS amount, b.category_id
             FROM bill_payments bp
             JOIN bills b ON b.id = bp.bill_id
            WHERE bp.status = 'paid'
              AND bp.paid_date BETWEEN $1::date AND $2::date
           UNION ALL
           SELECT amount, category_id
             FROM one_time_expenses
            WHERE expense_date BETWEEN $1::date AND $2::date
         ) s
         LEFT JOIN expense_categories ec ON ec.id = s.category_id
         GROUP BY ec.name
     )
     SELECT * FROM agg ORDER BY total DESC`,
    [startDate, endDate],
  );
  const total = cat.reduce((s, r) => s + Number(r.total), 0);
  return {
    type: 'bills_expenses',
    title: 'Expense Breakdown',
    period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
    columns: [
      { key: 'category_name', label: 'Category' },
      { key: 'total', label: 'Total', type: 'currency', align: 'right' },
      { key: 'share', label: 'Share %', type: 'percent', align: 'right' },
    ],
    rows: cat.map((r) => ({
      category_name: r.category_name,
      total: money(r.total),
      share: total > 0 ? Math.round((r.total / total) * 1000) / 10 : 0,
    })),
    totals: { total: money(total), share: 100 },
  };
}

async function billsOverdue(_params) {
  const { rows } = await query(
    `SELECT b.name AS bill_name, ec.name AS category_name,
            bp.due_date, bp.amount_due, bp.status,
            (CURRENT_DATE - bp.due_date)::int AS days_overdue
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
       LEFT JOIN expense_categories ec ON ec.id = b.category_id
      WHERE bp.status IN ('overdue','due')
        AND bp.due_date <= CURRENT_DATE
      ORDER BY bp.due_date ASC`,
  );
  return {
    type: 'bills_overdue',
    title: 'Overdue Bills',
    period: { label: `As of ${todayIso()}` },
    columns: [
      { key: 'bill_name', label: 'Bill' },
      { key: 'category_name', label: 'Category' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_overdue', label: 'Days Overdue', type: 'int', align: 'right' },
      { key: 'amount_due', label: 'Amount Due', type: 'currency', align: 'right' },
    ],
    rows: rows.map((r) => ({
      bill_name: r.bill_name,
      category_name: r.category_name || '—',
      due_date: dateOnly(r.due_date),
      days_overdue: Math.max(0, r.days_overdue),
      amount_due: money(r.amount_due),
    })),
    totals: {
      amount_due: money(rows.reduce((s, r) => s + Number(r.amount_due), 0)),
    },
  };
}

// =======================================================================
// Financial — net profit (proper period buckets)
// =======================================================================
async function netProfit(params) {
  const period = String(params.period || 'monthly').toLowerCase();
  const now = new Date();
  const year = Number(params.year) || now.getFullYear();
  // Build bucket date ranges based on the requested period type.
  let buckets;
  if (period === 'daily') {
    const { startDate, endDate } = parseDateRange(params);
    buckets = [];
    const cur = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      buckets.push({ label: d, start: d, end: d });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (period === 'quarterly') {
    buckets = [0, 1, 2, 3].map((q) => ({
      label: `Q${q + 1} ${year}`,
      start: new Date(Date.UTC(year, q * 3, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(year, q * 3 + 3, 0)).toISOString().slice(0, 10),
    }));
  } else if (period === 'halfyear') {
    buckets = [
      { label: `H1 ${year}`, start: `${year}-01-01`, end: `${year}-06-30` },
      { label: `H2 ${year}`, start: `${year}-07-01`, end: `${year}-12-31` },
    ];
  } else if (period === 'yearly') {
    buckets = [
      { label: `${year}`, start: `${year}-01-01`, end: `${year}-12-31` },
    ];
  } else {
    buckets = [];
    for (let m = 0; m < 12; m += 1) {
      const start = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);
      const label = new Date(Date.UTC(year, m, 1)).toLocaleString('default', {
        month: 'short',
        year: 'numeric',
      });
      buckets.push({ label, start, end });
    }
  }

  const rows = [];
  for (const b of buckets) {
    const pl = await financialReportService.getProfitAndLoss({
      startDate: b.start,
      endDate: b.end,
      compare: false,
    });
    rows.push({
      period: b.label,
      revenue: pl.revenue.total,
      cogs: pl.cogs.total,
      gross_profit: pl.grossProfit,
      gross_margin: pl.grossMargin,
      expenses: pl.expenses.total,
      net_profit: pl.netProfit,
      net_margin: pl.netMargin,
    });
  }
  return {
    type: 'net_profit',
    title: `Net Profit — ${period}`,
    period: {
      label:
        period === 'daily'
          ? rangeLabel(parseDateRange(params))
          : `${period} ${year}`,
    },
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
      { key: 'cogs', label: 'COGS', type: 'currency', align: 'right' },
      { key: 'gross_profit', label: 'Gross Profit', type: 'currency', align: 'right' },
      { key: 'gross_margin', label: 'GP %', type: 'percent', align: 'right' },
      { key: 'expenses', label: 'Expenses', type: 'currency', align: 'right' },
      { key: 'net_profit', label: 'Net Profit', type: 'currency', align: 'right' },
      { key: 'net_margin', label: 'NP %', type: 'percent', align: 'right' },
    ],
    rows,
    totals: {
      revenue: money(rows.reduce((s, r) => s + r.revenue, 0)),
      cogs: money(rows.reduce((s, r) => s + r.cogs, 0)),
      gross_profit: money(rows.reduce((s, r) => s + r.gross_profit, 0)),
      expenses: money(rows.reduce((s, r) => s + r.expenses, 0)),
      net_profit: money(rows.reduce((s, r) => s + r.net_profit, 0)),
    },
  };
}

// =======================================================================
// Dispatcher
// =======================================================================
const REGISTRY = {
  // Financial
  net_profit: { fn: netProfit, permission: 'report.financial' },
  profit_loss: {
    fn: async (p) => {
      const { startDate, endDate } = parseDateRange(p);
      const pl = await financialReportService.getProfitAndLoss({
        startDate,
        endDate,
        compare: p.compare === 'true' || p.compare === true,
      });
      return {
        type: 'profit_loss',
        title: 'Profit & Loss',
        period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) },
        raw: pl,
      };
    },
    permission: 'report.financial',
  },
  balance_sheet: {
    fn: async (p) => {
      const asOf = dateOnly(p.as_of_date) || todayIso();
      const bs = await financialReportService.getBalanceSheet({ asOfDate: asOf });
      return { type: 'balance_sheet', title: 'Balance Sheet', period: { label: `As of ${asOf}` }, raw: bs };
    },
    permission: 'report.financial',
  },
  cash_flow: {
    fn: async (p) => {
      const { startDate, endDate } = parseDateRange(p);
      const cf = await financialReportService.getCashFlowStatement({ startDate, endDate });
      return { type: 'cash_flow', title: 'Cash Flow', period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) }, raw: cf };
    },
    permission: 'report.financial',
  },
  vat: {
    fn: async (p) => {
      const { startDate, endDate } = parseDateRange(p);
      const v = await financialReportService.getVATReport({ startDate, endDate });
      return { type: 'vat', title: 'VAT Report', period: { startDate, endDate, label: rangeLabel({ startDate, endDate }) }, raw: v };
    },
    permission: 'report.financial',
  },

  // Sales
  sales_summary: { fn: salesSummary, permission: 'report.sales' },
  sales_by_period: { fn: salesByPeriod, permission: 'report.sales' },
  sales_by_product: { fn: salesByProduct, permission: 'report.sales' },
  sales_by_category: { fn: salesByCategory, permission: 'report.sales' },
  sales_by_employee: { fn: salesByEmployee, permission: 'report.sales' },
  sales_by_payment_method: { fn: salesByPaymentMethod, permission: 'report.sales' },
  sales_invoices: { fn: salesInvoices, permission: 'report.sales' },

  // Inventory
  inventory_stock_levels: { fn: inventoryStockLevels, permission: 'report.inventory' },
  inventory_movements: { fn: inventoryMovements, permission: 'report.inventory' },
  inventory_valuation: { fn: inventoryValuation, permission: 'report.inventory' },
  low_stock: { fn: lowStock, permission: 'report.inventory' },
  dead_stock: { fn: deadStock, permission: 'report.inventory' },
  inventory_stock_counts: { fn: stockCounts, permission: 'report.inventory' },

  // Suppliers
  supplier_summary: { fn: supplierSummary, permission: 'report.suppliers' },
  supplier_payables: { fn: supplierPayables, permission: 'report.suppliers' },
  supplier_purchases: { fn: supplierPurchases, permission: 'report.suppliers' },
  supplier_payments: { fn: supplierPaymentsReport, permission: 'report.suppliers' },
  supplier_returns: { fn: supplierReturns, permission: 'report.suppliers' },

  // Customers
  customer_summary: { fn: customerSummary, permission: 'report.customers' },
  customer_receivables: { fn: customerReceivables, permission: 'report.customers' },
  customer_payments: { fn: customerPayments, permission: 'report.customers' },
  customer_top: { fn: customerTop, permission: 'report.customers' },
  customer_inactive: { fn: customerInactive, permission: 'report.customers' },

  // Employees
  employee_performance: { fn: employeePerformance, permission: 'report.employees' },
  employee_activity: { fn: employeeActivity, permission: 'report.employees' },
  payroll: { fn: payroll, permission: 'report.employees' },

  // Attendance
  attendance_monthly_sheet: { fn: attendanceMonthlySheet, permission: 'report.attendance' },
  attendance_summary: { fn: attendanceSummary, permission: 'report.attendance' },
  attendance_late: { fn: attendanceLate, permission: 'report.attendance' },
  attendance_leave: { fn: attendanceLeave, permission: 'report.attendance' },
  attendance_overtime: { fn: attendanceOvertime, permission: 'report.attendance' },

  // Warranty
  warranty_active: { fn: warrantyActive, permission: 'report.warranty' },
  warranty_claims: { fn: warrantyClaims, permission: 'report.warranty' },
  warranty_by_product: { fn: warrantyByProduct, permission: 'report.warranty' },

  // Returns
  returns_summary: { fn: returnsSummary, permission: 'report.returns' },
  returns_requests: { fn: returnsRequests, permission: 'report.returns' },
  returns_by_product: { fn: returnsByProduct, permission: 'report.returns' },

  // Bills
  bills_summary: { fn: billsSummary, permission: 'report.bills' },
  bills_expenses: { fn: billsExpenses, permission: 'report.bills' },
  bills_overdue: { fn: billsOverdue, permission: 'report.bills' },
};

function isValidType(type) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

function requiredPermission(type) {
  return REGISTRY[type]?.permission || 'report.sales';
}

async function generateReport(type, params = {}) {
  if (!isValidType(type)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Unknown report type "${type}".`,
      { status: 400 },
    );
  }
  const data = await REGISTRY[type].fn(params);
  return {
    ...data,
    meta: {
      generatedAt: new Date().toISOString(),
      rowCount: data.rows?.length || 0,
    },
  };
}

module.exports = {
  generateReport,
  isValidType,
  requiredPermission,
  REGISTRY,
};
