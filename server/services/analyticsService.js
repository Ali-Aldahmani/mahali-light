const { query } = require('../db/postgres');

// =======================================================================
// Helpers
// =======================================================================
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseDateRange(params = {}) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const defStart = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const defEnd = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return {
    startDate: (params.start_date || params.startDate || defStart).slice(0, 10),
    endDate: (params.end_date || params.endDate || defEnd).slice(0, 10),
  };
}

// Calculates the same-length window directly before [start, end] so reports
// have an apples-to-apples baseline regardless of period length.
function previousRange({ startDate, endDate }) {
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  const diffDays = Math.max(1, Math.round((e - s) / 86400000) + 1);
  const prevEnd = new Date(s);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (diffDays - 1));
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
  };
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || Math.abs(previous) < 0.0001) {
    if (!Number.isFinite(current) || Math.abs(current) < 0.0001) return 0;
    return 100;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// =======================================================================
// Net profit trends
// =======================================================================
async function getNetProfitTrends({ groupBy = 'month', startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const truncMap = { day: 'day', week: 'week', month: 'month', year: 'year' };
  const trunc = truncMap[groupBy] || 'month';

  // Revenue from journal lines, on the income credit side. Falls back to
  // invoice totals when no journal data exists (early test installs).
  const { rows } = await query(
    `WITH buckets AS (
       SELECT date_trunc('${trunc}', generated_at)::date AS bucket
         FROM generate_series($1::date, $2::date, '1 ${trunc}'::interval) AS generated_at
     ),
     sales AS (
       SELECT date_trunc('${trunc}', confirmed_at)::date AS bucket,
              COALESCE(SUM(taxable_amount),0)::float8 AS revenue,
              COALESCE(SUM(total),0)::float8 AS gross,
              COALESCE(SUM(quantity_cost), 0)::float8 AS cogs
         FROM (
           SELECT i.confirmed_at, i.taxable_amount, i.total,
                  COALESCE(SUM(ii.quantity * ii.cost_price_at_time), 0) AS quantity_cost
             FROM invoices i
             LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
            WHERE i.status = 'confirmed'
              AND i.confirmed_at::date BETWEEN $1::date AND $2::date
            GROUP BY i.id
         ) inv
        GROUP BY 1
     ),
     expenses AS (
       SELECT date_trunc('${trunc}', d)::date AS bucket,
              COALESCE(SUM(amount), 0)::float8 AS expenses
         FROM (
           SELECT bp.paid_date AS d, bp.amount_paid AS amount
             FROM bill_payments bp
            WHERE bp.paid_date IS NOT NULL
              AND bp.paid_date BETWEEN $1::date AND $2::date
           UNION ALL
           SELECT expense_date AS d, amount FROM one_time_expenses
            WHERE expense_date BETWEEN $1::date AND $2::date
         ) all_exp
        GROUP BY 1
     )
     SELECT b.bucket,
            COALESCE(s.revenue, 0)::float8 AS revenue,
            COALESCE(s.cogs, 0)::float8 AS cogs,
            COALESCE(e.expenses, 0)::float8 AS expenses
       FROM buckets b
       LEFT JOIN sales s ON s.bucket = b.bucket
       LEFT JOIN expenses e ON e.bucket = b.bucket
      ORDER BY b.bucket`,
    [range.startDate, range.endDate],
  );

  let prevNet = null;
  return rows.map((r) => {
    const revenue = money(r.revenue);
    const cogs = money(r.cogs);
    const expenses = money(r.expenses);
    const grossProfit = money(revenue - cogs);
    const netProfit = money(grossProfit - expenses);
    const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;
    const vsPrevPct = prevNet == null ? null : percentChange(netProfit, prevNet);
    prevNet = netProfit;
    return {
      bucket: r.bucket?.toISOString?.().slice(0, 10) || r.bucket,
      revenue,
      cogs,
      gross_profit: grossProfit,
      expenses,
      net_profit: netProfit,
      margin_pct: marginPct,
      vs_previous_pct: vsPrevPct,
    };
  });
}

// =======================================================================
// Top / Worst products
// =======================================================================
async function getTopProducts({
  startDate,
  endDate,
  limit = 10,
  sortBy = 'revenue',
  descending = true,
} = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const sortCol =
    sortBy === 'profit'
      ? 'gross_profit'
      : sortBy === 'quantity'
        ? 'units_sold'
        : sortBy === 'margin'
          ? 'margin_pct'
          : 'revenue';

  // Current month isn't aggregated yet — pull straight from invoice_items
  // for the whole window. Historical performance for completed months can
  // still come from sales_history_monthly when callers care about speed.
  const { rows } = await query(
    `WITH sales AS (
       SELECT ii.product_id, ii.variant_id, ii.product_name, ii.sku,
              SUM(ii.quantity)::float8 AS units_sold,
              SUM(ii.line_total)::float8 AS revenue,
              SUM(ii.quantity * ii.cost_price_at_time)::float8 AS cost_total,
              SUM(ii.line_total - ii.quantity * ii.cost_price_at_time)::float8 AS gross_profit,
              COUNT(DISTINCT i.id)::int AS invoice_count
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'confirmed'
          AND i.confirmed_at::date BETWEEN $1::date AND $2::date
        GROUP BY ii.product_id, ii.variant_id, ii.product_name, ii.sku
     ),
     returns AS (
       SELECT roi.product_id, roi.variant_id,
              SUM(roi.quantity)::float8 AS qty,
              SUM(roi.total_value)::float8 AS value
         FROM return_order_items roi
         JOIN return_orders ro ON ro.id = roi.return_order_id
        WHERE ro.created_at::date BETWEEN $1::date AND $2::date
        GROUP BY roi.product_id, roi.variant_id
     )
     SELECT s.*,
            COALESCE(r.qty, 0)::float8 AS returned_qty,
            COALESCE(r.value, 0)::float8 AS returned_value,
            CASE WHEN s.units_sold > 0
                 THEN (COALESCE(r.qty,0)/s.units_sold * 100)
                 ELSE 0 END AS return_rate_pct,
            CASE WHEN s.revenue > 0
                 THEN (s.gross_profit / s.revenue * 100)
                 ELSE 0 END AS margin_pct,
            p.image_path,
            pc.name AS category_name
       FROM sales s
       LEFT JOIN returns r ON r.variant_id = s.variant_id
       LEFT JOIN products p ON p.id = s.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      ORDER BY ${sortCol} ${descending ? 'DESC' : 'ASC'}
      LIMIT $3`,
    [range.startDate, range.endDate, Math.min(Math.max(Number(limit) || 10, 1), 200)],
  );

  return rows.map((r, idx) => ({
    rank: idx + 1,
    product_id: r.product_id,
    variant_id: r.variant_id,
    product_name: r.product_name,
    sku: r.sku || '',
    image_path: r.image_path || null,
    category_name: r.category_name || null,
    units_sold: Number(r.units_sold) || 0,
    revenue: money(r.revenue),
    cost_total: money(r.cost_total),
    gross_profit: money(r.gross_profit),
    margin_pct: Math.round(Number(r.margin_pct) * 10) / 10,
    return_rate_pct: Math.round(Number(r.return_rate_pct) * 10) / 10,
    invoice_count: r.invoice_count,
  }));
}

async function getWorstProducts(params) {
  return getTopProducts({ ...params, descending: false });
}

// =======================================================================
// Suppliers
// =======================================================================
async function getTopSuppliers({ startDate, endDate, limit = 10 } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const { rows } = await query(
    `WITH po AS (
       SELECT s.id, s.name,
              COUNT(p.id)::int AS total_orders,
              COALESCE(SUM(p.total_cost), 0)::float8 AS total_spent,
              AVG(EXTRACT(EPOCH FROM (p.received_date - p.order_date)) / 86400)::float8 AS avg_lead_time_days,
              SUM(CASE WHEN p.received_date IS NOT NULL
                        AND p.received_date <= p.expected_date THEN 1 ELSE 0 END)::float8 AS on_time_count,
              SUM(CASE WHEN p.received_date IS NOT NULL
                        AND p.expected_date IS NOT NULL THEN 1 ELSE 0 END)::float8 AS total_complete
         FROM suppliers s
         LEFT JOIN purchase_orders p ON p.supplier_id = s.id
                                    AND p.status <> 'cancelled'
                                    AND p.created_at::date BETWEEN $1::date AND $2::date
        GROUP BY s.id, s.name
     ),
     defects AS (
       SELECT ro.supplier_id, COUNT(*)::int AS return_count,
              COALESCE(SUM(ro.total_value), 0)::float8 AS return_value
         FROM return_orders ro
        WHERE ro.return_type = 'supplier_return'
          AND ro.created_at::date BETWEEN $1::date AND $2::date
        GROUP BY ro.supplier_id
     ),
     po_value AS (
       SELECT supplier_id,
              COALESCE(SUM(total_cost), 0)::float8 AS total
         FROM purchase_orders
        WHERE status <> 'cancelled'
          AND created_at::date BETWEEN $1::date AND $2::date
        GROUP BY supplier_id
     ),
     categories AS (
       SELECT po.supplier_id, COUNT(DISTINCT p.category_id)::int AS categories_supplied
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
         JOIN products p ON p.id = poi.product_id
        WHERE po.created_at::date BETWEEN $1::date AND $2::date
        GROUP BY po.supplier_id
     )
     SELECT po.*,
            COALESCE(d.return_count, 0)::int AS return_count,
            COALESCE(d.return_value, 0)::float8 AS return_value,
            CASE WHEN COALESCE(pv.total, 0) > 0
                 THEN (COALESCE(d.return_value, 0) / pv.total * 100)
                 ELSE 0 END AS defect_rate_pct,
            CASE WHEN COALESCE(po.total_complete, 0) > 0
                 THEN (po.on_time_count / po.total_complete * 100)
                 ELSE NULL END AS on_time_rate_pct,
            COALESCE(c.categories_supplied, 0)::int AS categories_supplied
       FROM po
       LEFT JOIN defects d ON d.supplier_id = po.id
       LEFT JOIN po_value pv ON pv.supplier_id = po.id
       LEFT JOIN categories c ON c.supplier_id = po.id
      WHERE po.total_orders > 0
      ORDER BY po.total_spent DESC
      LIMIT $3`,
    [range.startDate, range.endDate, Math.min(Math.max(Number(limit) || 10, 1), 100)],
  );

  return rows.map((r, idx) => ({
    rank: idx + 1,
    supplier_id: r.id,
    supplier_name: r.name,
    total_orders: r.total_orders,
    total_spent: money(r.total_spent),
    avg_lead_time_days:
      r.avg_lead_time_days != null
        ? Math.round(Number(r.avg_lead_time_days) * 10) / 10
        : null,
    on_time_rate_pct:
      r.on_time_rate_pct != null
        ? Math.round(Number(r.on_time_rate_pct) * 10) / 10
        : null,
    defect_rate_pct: Math.round(Number(r.defect_rate_pct) * 10) / 10,
    return_count: r.return_count,
    categories_supplied: r.categories_supplied,
  }));
}

async function getWorstSuppliers(params) {
  const range = parseDateRange({
    start_date: params?.start_date,
    end_date: params?.end_date,
  });
  // Different ordering than top — we want worst reliability + slowest +
  // overdue. Filter to suppliers we've actually transacted with.
  const { rows } = await query(
    `WITH po AS (
       SELECT s.id, s.name,
              COUNT(p.id)::int AS total_orders,
              COALESCE(SUM(p.total_cost), 0)::float8 AS total_spent,
              AVG(EXTRACT(EPOCH FROM (p.received_date - p.order_date)) / 86400)::float8 AS avg_lead_time_days,
              COUNT(p.id) FILTER (
                WHERE p.balance_due > 0
                  AND COALESCE(p.due_date, p.created_at::date) < CURRENT_DATE
              )::int AS overdue_count,
              COALESCE(SUM(CASE WHEN p.balance_due > 0
                                 AND COALESCE(p.due_date, p.created_at::date) < CURRENT_DATE
                                 THEN p.balance_due ELSE 0 END), 0)::float8 AS overdue_amount
         FROM suppliers s
         LEFT JOIN purchase_orders p ON p.supplier_id = s.id
                                    AND p.status <> 'cancelled'
        GROUP BY s.id, s.name
     ),
     defects AS (
       SELECT ro.supplier_id, COUNT(*)::int AS return_count,
              COALESCE(SUM(ro.total_value), 0)::float8 AS return_value
         FROM return_orders ro
        WHERE ro.return_type = 'supplier_return'
          AND ro.created_at::date BETWEEN $1::date AND $2::date
        GROUP BY ro.supplier_id
     )
     SELECT po.*,
            COALESCE(d.return_count, 0)::int AS return_count,
            COALESCE(d.return_value, 0)::float8 AS return_value,
            CASE WHEN po.total_spent > 0
                 THEN (COALESCE(d.return_value, 0) / po.total_spent * 100)
                 ELSE 0 END AS defect_rate_pct
       FROM po
       LEFT JOIN defects d ON d.supplier_id = po.id
      WHERE po.total_orders > 0
      ORDER BY defect_rate_pct DESC, overdue_amount DESC
      LIMIT $3`,
    [range.startDate, range.endDate, Math.min(Math.max(Number(params?.limit) || 10, 1), 100)],
  );

  return rows.map((r, idx) => ({
    rank: idx + 1,
    supplier_id: r.id,
    supplier_name: r.name,
    total_orders: r.total_orders,
    total_spent: money(r.total_spent),
    avg_lead_time_days:
      r.avg_lead_time_days != null
        ? Math.round(Number(r.avg_lead_time_days) * 10) / 10
        : null,
    defect_rate_pct: Math.round(Number(r.defect_rate_pct) * 10) / 10,
    return_count: r.return_count,
    overdue_count: r.overdue_count,
    overdue_amount: money(r.overdue_amount),
  }));
}

// =======================================================================
// Customers
// =======================================================================
async function getTopCustomers({ startDate, endDate, limit = 10 } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone, c.credit_balance,
            COUNT(i.id)::int AS invoice_count,
            COALESCE(SUM(i.total), 0)::float8 AS total_spent,
            COALESCE(AVG(i.total), 0)::float8 AS avg_order_value,
            MAX(i.confirmed_at) AS last_purchase,
            (CURRENT_DATE - MAX(i.confirmed_at)::date)::int AS last_purchase_days_ago,
            CASE
              WHEN COALESCE(SUM(i.total), 0) = 0 THEN NULL
              ELSE ((COALESCE(SUM(i.total),0) - c.credit_balance)
                    / NULLIF(COALESCE(SUM(i.total),0), 0) * 100)
            END AS on_time_payment_rate
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id
                           AND i.status = 'confirmed'
                           AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY c.id
     HAVING COUNT(i.id) > 0
      ORDER BY total_spent DESC
      LIMIT $3`,
    [range.startDate, range.endDate, Math.min(Math.max(Number(limit) || 10, 1), 100)],
  );
  return rows.map((r, idx) => ({
    rank: idx + 1,
    customer_id: r.id,
    customer_name: r.name,
    phone: r.phone,
    credit_balance: money(r.credit_balance),
    invoice_count: r.invoice_count,
    total_spent: money(r.total_spent),
    avg_order_value: money(r.avg_order_value),
    last_purchase: r.last_purchase,
    last_purchase_days_ago: r.last_purchase_days_ago,
    on_time_payment_rate:
      r.on_time_payment_rate != null
        ? Math.round(Number(r.on_time_payment_rate) * 10) / 10
        : null,
  }));
}

async function getAtRiskCustomers({
  inactiveDays = 60,
  balanceThreshold = 0,
  limit = 50,
} = {}) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.phone, c.credit_balance, c.credit_limit,
            MAX(i.confirmed_at) AS last_purchase,
            (CURRENT_DATE - MAX(i.confirmed_at)::date)::int AS last_purchase_days_ago,
            COUNT(i.id)::int AS lifetime_invoices,
            COALESCE(SUM(i.total), 0)::float8 AS lifetime_spent
       FROM customers c
       LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'confirmed'
      WHERE c.is_active = true
      GROUP BY c.id
     HAVING (
        (MAX(i.confirmed_at) IS NULL
         OR MAX(i.confirmed_at) < NOW() - ($1 || ' days')::interval)
        OR c.credit_balance >= $2
     )
      ORDER BY c.credit_balance DESC NULLS LAST, lifetime_spent DESC
      LIMIT $3`,
    [Math.max(1, Number(inactiveDays)), Number(balanceThreshold) || 0, Number(limit) || 50],
  );
  return rows.map((r) => ({
    customer_id: r.id,
    customer_name: r.name,
    phone: r.phone,
    credit_balance: money(r.credit_balance),
    credit_limit: money(r.credit_limit),
    last_purchase: r.last_purchase,
    last_purchase_days_ago: r.last_purchase_days_ago,
    lifetime_invoices: r.lifetime_invoices,
    lifetime_spent: money(r.lifetime_spent),
    risk_reason:
      r.credit_balance > 0 && r.last_purchase_days_ago > inactiveDays
        ? 'inactive_with_balance'
        : r.credit_balance > 0
          ? 'large_balance'
          : 'inactive',
  }));
}

// =======================================================================
// Employees
// =======================================================================
async function getEmployeePerformance({
  startDate,
  endDate,
  employeeId = null,
} = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const conds = ["i.confirmed_at::date BETWEEN $1::date AND $2::date"];
  const vals = [range.startDate, range.endDate];
  if (employeeId) {
    vals.push(employeeId);
    conds.push(`u.id = $${vals.length}`);
  }

  const { rows } = await query(
    `WITH invs AS (
       SELECT u.id AS user_id, u.username, e.name AS employee_name, e.id AS employee_id,
              COUNT(i.id)::int AS invoices_created,
              COALESCE(SUM(i.total), 0)::float8 AS revenue_generated,
              COALESCE(AVG(i.total), 0)::float8 AS avg_invoice_value,
              COALESCE(SUM(i.discount_amount + i.invoice_discount), 0)::float8 AS discounts_given
         FROM invoices i
         JOIN users u ON u.id = i.confirmed_by
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE i.status = 'confirmed'
          AND ${conds.join(' AND ')}
        GROUP BY u.id, u.username, e.id, e.name
     ),
     returns AS (
       SELECT requested_by AS user_id,
              COUNT(*)::int AS return_request_count,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count
         FROM return_requests
        WHERE requested_at::date BETWEEN $1::date AND $2::date
        GROUP BY requested_by
     ),
     collections AS (
       SELECT employee_id AS user_id,
              COALESCE(SUM(amount), 0)::float8 AS collections_amount
         FROM customer_payments
        WHERE payment_date BETWEEN $1::date AND $2::date
        GROUP BY employee_id
     ),
     att AS (
       SELECT e.id AS employee_id,
              COUNT(*) FILTER (WHERE a.status IN ('present','late','half_day'))::int AS present_days,
              COUNT(*) FILTER (WHERE a.status = 'late')::int AS late_count,
              COUNT(a.id)::int AS total_days
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id
                               AND a.date BETWEEN $1::date AND $2::date
        GROUP BY e.id
     )
     SELECT invs.*,
            COALESCE(r.return_request_count, 0)::int AS return_request_count,
            CASE WHEN COALESCE(r.return_request_count, 0) > 0
                 THEN (r.approved_count::float8 / r.return_request_count * 100)
                 ELSE 0 END AS return_approval_rate,
            COALESCE(c.collections_amount, 0)::float8 AS collections_amount,
            COALESCE(att.present_days, 0)::int AS attendance_present_days,
            COALESCE(att.late_count, 0)::int AS late_count,
            CASE WHEN COALESCE(att.total_days, 0) > 0
                 THEN (att.present_days::float8 / att.total_days * 100)
                 ELSE NULL END AS attendance_rate_pct,
            CASE WHEN invs.revenue_generated > 0
                 THEN (invs.discounts_given / invs.revenue_generated * 100)
                 ELSE 0 END AS discount_rate_pct
       FROM invs
       LEFT JOIN returns r ON r.user_id = invs.user_id
       LEFT JOIN collections c ON c.user_id = invs.user_id
       LEFT JOIN att ON att.employee_id = invs.employee_id
      ORDER BY revenue_generated DESC`,
    vals,
  );

  return rows.map((r, idx) => ({
    rank: idx + 1,
    user_id: r.user_id,
    employee_id: r.employee_id,
    employee_name: r.employee_name || r.username,
    invoices_created: r.invoices_created,
    revenue_generated: money(r.revenue_generated),
    avg_invoice_value: money(r.avg_invoice_value),
    discount_rate_pct: Math.round(Number(r.discount_rate_pct) * 10) / 10,
    return_request_count: r.return_request_count,
    return_approval_rate: Math.round(Number(r.return_approval_rate) * 10) / 10,
    collections_amount: money(r.collections_amount),
    attendance_rate_pct:
      r.attendance_rate_pct != null
        ? Math.round(Number(r.attendance_rate_pct) * 10) / 10
        : null,
    late_count: r.late_count,
  }));
}

// =======================================================================
// Peaks (hours / days / months)
// =======================================================================
async function getPeakHours({ startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const { rows } = await query(
    `SELECT EXTRACT(HOUR FROM confirmed_at)::int AS hour,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total), 0)::float8 AS revenue
       FROM invoices
      WHERE status = 'confirmed'
        AND confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY 1
      ORDER BY 1`,
    [range.startDate, range.endDate],
  );
  const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
  const series = [];
  for (let h = 0; h < 24; h += 1) {
    const r = byHour.get(h);
    series.push({
      hour: h,
      invoice_count: r ? Number(r.invoice_count) : 0,
      revenue: r ? money(r.revenue) : 0,
    });
  }
  const sorted = [...series].sort((a, b) => b.invoice_count - a.invoice_count);
  const peak = sorted.slice(0, 3).map((p) => p.hour);
  const slow = sorted
    .filter((p) => p.invoice_count > 0)
    .slice(-3)
    .map((p) => p.hour);
  return { series, peak_hours: peak, slow_hours: slow };
}

async function getPeakDays({ startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  // EXTRACT(DOW): 0=Sun..6=Sat. Map to UAE-friendly 1=Sun..7=Sat for display.
  const { rows } = await query(
    `SELECT EXTRACT(DOW FROM confirmed_at)::int AS dow,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total), 0)::float8 AS revenue
       FROM invoices
      WHERE status = 'confirmed'
        AND confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY 1
      ORDER BY 1`,
    [range.startDate, range.endDate],
  );
  const byDow = new Map(rows.map((r) => [Number(r.dow), r]));
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const series = dayNames.map((name, dow) => {
    const r = byDow.get(dow);
    return {
      dow,
      label: name,
      is_weekend: dow === 5 || dow === 6, // UAE weekend: Fri-Sat
      invoice_count: r ? Number(r.invoice_count) : 0,
      revenue: r ? money(r.revenue) : 0,
    };
  });
  return { series };
}

// 7×24 grid for the big heatmap. Returns one cell per (dow, hour).
async function getPeakHeatmap({ startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const { rows } = await query(
    `SELECT EXTRACT(DOW FROM confirmed_at)::int AS dow,
            EXTRACT(HOUR FROM confirmed_at)::int AS hour,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total), 0)::float8 AS revenue
       FROM invoices
      WHERE status = 'confirmed'
        AND confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2`,
    [range.startDate, range.endDate],
  );
  const lookup = new Map();
  let maxCount = 0;
  for (const r of rows) {
    const key = `${r.dow}-${r.hour}`;
    const count = Number(r.invoice_count);
    if (count > maxCount) maxCount = count;
    lookup.set(key, { count, revenue: money(r.revenue) });
  }
  const cells = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const cell = lookup.get(`${d}-${h}`) || { count: 0, revenue: 0 };
      cells.push({ dow: d, hour: h, invoice_count: cell.count, revenue: cell.revenue });
    }
  }
  return { cells, max_count: maxCount };
}

async function getPeakMonths({ year, compareYear } = {}) {
  const targetYear = Number(year) || new Date().getFullYear();
  const prevYear = Number(compareYear) || targetYear - 1;
  const { rows } = await query(
    `SELECT year, month,
            COALESCE(SUM(units_sold), 0)::float8 AS units,
            COALESCE(SUM(revenue), 0)::float8 AS revenue,
            COUNT(DISTINCT variant_id)::int AS variant_count
       FROM sales_history_monthly
      WHERE year IN ($1, $2)
      GROUP BY year, month
      ORDER BY year, month`,
    [targetYear, prevYear],
  );

  // sales_history_monthly skips the current month — fold raw invoices in
  // so the chart doesn't have an empty trailing bar.
  const { rows: live } = await query(
    `SELECT EXTRACT(YEAR FROM confirmed_at)::int AS year,
            EXTRACT(MONTH FROM confirmed_at)::int AS month,
            COALESCE(SUM(taxable_amount), 0)::float8 AS revenue
       FROM invoices
      WHERE status = 'confirmed'
        AND EXTRACT(YEAR FROM confirmed_at) IN ($1, $2)
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [targetYear, prevYear],
  );

  const map = new Map();
  for (const r of rows) {
    map.set(`${r.year}-${r.month}`, { revenue: Number(r.revenue), units: Number(r.units) });
  }
  for (const r of live) {
    // Live data overrides aggregated data — keeps the current month fresh.
    const key = `${r.year}-${r.month}`;
    const existing = map.get(key) || { revenue: 0, units: 0 };
    if (existing.revenue === 0) map.set(key, { ...existing, revenue: Number(r.revenue) });
  }

  function buildYearSeries(y) {
    const series = [];
    let total = 0;
    for (let m = 1; m <= 12; m += 1) {
      const v = map.get(`${y}-${m}`) || { revenue: 0, units: 0 };
      series.push({ month: m, revenue: money(v.revenue), units: Math.round(v.units * 100) / 100 });
      total += v.revenue;
    }
    return { series, total: money(total), avg: money(total / 12) };
  }

  const current = buildYearSeries(targetYear);
  const previous = buildYearSeries(prevYear);

  // Peak detection: month where revenue > 1.2 × annual average.
  const peakMonths = current.series
    .filter((m) => current.avg > 0 && m.revenue > current.avg * 1.2)
    .map((m) => m.month);

  return {
    year: targetYear,
    compare_year: prevYear,
    current,
    previous,
    peak_months: peakMonths,
    growth_pct: percentChange(current.total, previous.total),
  };
}

// =======================================================================
// Product seasonality (24 months)
// =======================================================================
async function getProductSeasonality(productId, { years = 2 } = {}) {
  const now = new Date();
  const startYear = now.getFullYear() - Math.max(0, Number(years) - 1);
  const { rows } = await query(
    `SELECT year, month,
            COALESCE(SUM(units_sold), 0)::float8 AS units,
            COALESCE(SUM(revenue), 0)::float8 AS revenue
       FROM sales_history_monthly
      WHERE product_id = $1 AND year >= $2
      GROUP BY year, month
      ORDER BY year, month`,
    [productId, startYear],
  );

  // Build 24-month series with seasonality index. Months missing from the
  // table get a 0 row so the chart still renders 24 bars.
  const series = [];
  for (let y = startYear; y <= now.getFullYear(); y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      // Stop at the last completed month so projections aren't polluted.
      if (y === now.getFullYear() && m > now.getMonth()) break;
      const r = rows.find((row) => Number(row.year) === y && Number(row.month) === m);
      series.push({
        year: y,
        month: m,
        units: r ? Math.round(Number(r.units) * 100) / 100 : 0,
        revenue: r ? money(r.revenue) : 0,
      });
    }
  }
  if (!series.length) {
    return { series: [], monthly_avg: [], peak_months: [], slow_months: [] };
  }
  const totalUnits = series.reduce((s, r) => s + r.units, 0);
  const monthsCovered = series.length;
  const annualAvg = totalUnits / monthsCovered;

  // Per calendar month avg.
  const monthBuckets = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
  for (const r of series) {
    monthBuckets[r.month - 1].total += r.units;
    monthBuckets[r.month - 1].count += 1;
  }
  const monthlyAvg = monthBuckets.map((b, idx) => {
    const avg = b.count > 0 ? b.total / b.count : 0;
    return {
      month: idx + 1,
      avg_units: Math.round(avg * 100) / 100,
      seasonality_index:
        annualAvg > 0 ? Math.round((avg / annualAvg) * 1000) / 10 : 0,
    };
  });
  const peakMonths = monthlyAvg
    .filter((m) => m.seasonality_index > 120)
    .map((m) => m.month);
  const slowMonths = monthlyAvg
    .filter((m) => m.seasonality_index < 80 && m.seasonality_index > 0)
    .map((m) => m.month);
  return { series, monthly_avg: monthlyAvg, peak_months: peakMonths, slow_months: slowMonths };
}

// =======================================================================
// Dashboard / overview KPIs
// =======================================================================
async function getKPIs({ startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const prev = previousRange(range);

  // Bulk fetch — six counts in one round trip via CTE.
  const { rows: agg } = await query(
    `WITH inv AS (
       SELECT i.*,
              COALESCE((SELECT SUM(ii.quantity * ii.cost_price_at_time)
                          FROM invoice_items ii
                         WHERE ii.invoice_id = i.id), 0) AS cogs
         FROM invoices i
        WHERE i.status = 'confirmed'
     ),
     cur AS (
       SELECT COUNT(*)::int AS invoice_count,
              COALESCE(SUM(taxable_amount), 0)::float8 AS revenue,
              COALESCE(SUM(cogs), 0)::float8 AS cogs,
              COALESCE(SUM(total), 0)::float8 AS gross,
              COALESCE(AVG(total), 0)::float8 AS avg_order
         FROM inv
        WHERE confirmed_at::date BETWEEN $1::date AND $2::date
     ),
     prev_window AS (
       SELECT COUNT(*)::int AS invoice_count,
              COALESCE(SUM(taxable_amount), 0)::float8 AS revenue,
              COALESCE(SUM(cogs), 0)::float8 AS cogs,
              COALESCE(SUM(total), 0)::float8 AS gross,
              COALESCE(AVG(total), 0)::float8 AS avg_order
         FROM inv
        WHERE confirmed_at::date BETWEEN $3::date AND $4::date
     ),
     expenses_cur AS (
       SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM (
         SELECT amount_paid AS amount FROM bill_payments
          WHERE paid_date IS NOT NULL AND paid_date BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT amount FROM one_time_expenses
          WHERE expense_date BETWEEN $1::date AND $2::date
       ) e
     ),
     receivables AS (
       SELECT COALESCE(SUM(credit_balance), 0)::float8 AS total FROM customers
        WHERE credit_balance > 0
     ),
     payables AS (
       SELECT COALESCE(SUM(balance_due), 0)::float8 AS total FROM purchase_orders
        WHERE balance_due > 0 AND status <> 'cancelled'
     ),
     ret AS (
       SELECT COALESCE(SUM(refund_total), 0)::float8 AS refunds,
              COALESCE(SUM(total_value), 0)::float8 AS value
         FROM return_orders
        WHERE created_at::date BETWEEN $1::date AND $2::date
     ),
     inventory_value AS (
       SELECT COALESCE(SUM(stock_qty * cost_price), 0)::float8 AS total
         FROM product_variants
     )
     SELECT cur.*,
            prev_window.revenue AS prev_revenue,
            prev_window.cogs AS prev_cogs,
            prev_window.gross AS prev_gross,
            prev_window.avg_order AS prev_avg_order,
            expenses_cur.total AS expenses,
            receivables.total AS receivables_total,
            payables.total AS payables_total,
            ret.refunds AS refunds,
            ret.value AS returned_value,
            inventory_value.total AS inventory_value
       FROM cur, prev_window, expenses_cur, receivables, payables, ret, inventory_value`,
    [range.startDate, range.endDate, prev.startDate, prev.endDate],
  );

  const r = agg[0] || {};
  const revenue = Number(r.revenue || 0);
  const cogs = Number(r.cogs || 0);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - Number(r.expenses || 0);
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const prevRevenue = Number(r.prev_revenue || 0);
  const turnover =
    Number(r.inventory_value || 0) > 0
      ? Number(r.cogs || 0) / Number(r.inventory_value)
      : 0;
  const totalInvoicedGross = Number(r.gross || 0);
  const collectionRate =
    totalInvoicedGross > 0
      ? ((totalInvoicedGross - Number(r.receivables_total || 0)) / totalInvoicedGross) * 100
      : 0;
  const returnRate =
    totalInvoicedGross > 0
      ? (Number(r.returned_value || 0) / totalInvoicedGross) * 100
      : 0;
  const expenseRatio =
    revenue > 0 ? (Number(r.expenses || 0) / revenue) * 100 : 0;

  return {
    period: { startDate: range.startDate, endDate: range.endDate },
    previous_period: prev,
    revenue: money(revenue),
    revenue_growth_pct: percentChange(revenue, prevRevenue),
    gross_profit: money(grossProfit),
    gross_margin_pct: Math.round(grossMargin * 10) / 10,
    net_profit: money(netProfit),
    net_margin_pct: Math.round(netMargin * 10) / 10,
    expenses: money(Number(r.expenses || 0)),
    expense_ratio_pct: Math.round(expenseRatio * 10) / 10,
    inventory_value: money(Number(r.inventory_value || 0)),
    inventory_turnover: Math.round(turnover * 100) / 100,
    avg_order_value: money(r.avg_order || 0),
    avg_order_growth_pct: percentChange(Number(r.avg_order || 0), Number(r.prev_avg_order || 0)),
    return_rate_pct: Math.round(returnRate * 10) / 10,
    collection_rate_pct: Math.round(collectionRate * 10) / 10,
    receivables_total: money(Number(r.receivables_total || 0)),
    payables_total: money(Number(r.payables_total || 0)),
    refunds: money(Number(r.refunds || 0)),
    invoice_count: Number(r.invoice_count || 0),
  };
}

// 7-day sparkline source. Tiny by design so we can stuff several into the
// dashboard without hammering Postgres.
async function getSparkline(metric, { days = 7 } = {}) {
  const safe = Math.max(1, Math.min(60, Number(days) || 7));
  if (metric === 'revenue') {
    const { rows } = await query(
      `WITH days AS (
         SELECT generate_series((CURRENT_DATE - $1::int + 1), CURRENT_DATE, '1 day'::interval)::date AS d
       )
       SELECT days.d AS bucket,
              COALESCE(SUM(i.taxable_amount), 0)::float8 AS value
         FROM days
         LEFT JOIN invoices i ON i.status = 'confirmed' AND i.confirmed_at::date = days.d
        GROUP BY days.d
        ORDER BY days.d`,
      [safe],
    );
    return rows.map((r) => ({ bucket: r.bucket, value: money(r.value) }));
  }
  if (metric === 'orders') {
    const { rows } = await query(
      `WITH days AS (
         SELECT generate_series((CURRENT_DATE - $1::int + 1), CURRENT_DATE, '1 day'::interval)::date AS d
       )
       SELECT days.d AS bucket,
              COUNT(i.id)::int AS value
         FROM days
         LEFT JOIN invoices i ON i.status = 'confirmed' AND i.confirmed_at::date = days.d
        GROUP BY days.d
        ORDER BY days.d`,
      [safe],
    );
    return rows.map((r) => ({ bucket: r.bucket, value: r.value }));
  }
  return [];
}

// Specifically tuned for the dashboard "today" tile.
async function getDailySnapshot() {
  const { rows } = await query(
    `SELECT
       (SELECT COALESCE(SUM(taxable_amount), 0)::float8 FROM invoices
         WHERE status='confirmed' AND confirmed_at::date = CURRENT_DATE) AS today_revenue,
       (SELECT COALESCE(SUM(taxable_amount), 0)::float8 FROM invoices
         WHERE status='confirmed' AND confirmed_at::date = CURRENT_DATE - 1) AS yesterday_revenue,
       (SELECT COUNT(*)::int FROM invoices
         WHERE status='confirmed' AND confirmed_at::date = CURRENT_DATE) AS today_invoices,
       (SELECT COUNT(*)::int FROM invoices
         WHERE status='confirmed' AND confirmed_at::date = CURRENT_DATE - 1) AS yesterday_invoices`,
  );
  const r = rows[0] || {};
  return {
    today_revenue: money(r.today_revenue),
    yesterday_revenue: money(r.yesterday_revenue),
    today_invoices: r.today_invoices || 0,
    yesterday_invoices: r.yesterday_invoices || 0,
    revenue_growth_pct: percentChange(Number(r.today_revenue || 0), Number(r.yesterday_revenue || 0)),
  };
}

// Sales over time (used by the main dashboard area chart). Returns one
// row per day in the window plus the equivalent series for the previous
// window so the UI can render an overlay.
async function getSalesTimeline({ startDate, endDate } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const prev = previousRange(range);
  const { rows: current } = await query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
     )
     SELECT days.d AS bucket,
            COALESCE(SUM(i.taxable_amount), 0)::float8 AS revenue,
            COUNT(i.id)::int AS invoices
       FROM days
       LEFT JOIN invoices i ON i.status='confirmed' AND i.confirmed_at::date = days.d
      GROUP BY days.d
      ORDER BY days.d`,
    [range.startDate, range.endDate],
  );
  const { rows: previousRows } = await query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS d
     )
     SELECT days.d AS bucket,
            COALESCE(SUM(i.taxable_amount), 0)::float8 AS revenue
       FROM days
       LEFT JOIN invoices i ON i.status='confirmed' AND i.confirmed_at::date = days.d
      GROUP BY days.d
      ORDER BY days.d`,
    [prev.startDate, prev.endDate],
  );
  // Align by position so the two series sit on the same x-axis index.
  return current.map((r, idx) => ({
    bucket: r.bucket,
    revenue: money(r.revenue),
    invoices: r.invoices,
    previous_revenue: money(previousRows[idx]?.revenue || 0),
  }));
}

// Category split for the dashboard "Category Breakdown" bars.
async function getCategoryBreakdown({ startDate, endDate, limit = 8 } = {}) {
  const range = parseDateRange({ start_date: startDate, end_date: endDate });
  const { rows } = await query(
    `SELECT COALESCE(pc.name, 'Uncategorised') AS category_name,
            COALESCE(SUM(ii.line_total), 0)::float8 AS revenue,
            COALESCE(SUM(ii.quantity), 0)::float8 AS units
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      WHERE i.status = 'confirmed'
        AND i.confirmed_at::date BETWEEN $1::date AND $2::date
      GROUP BY pc.name
      ORDER BY revenue DESC
      LIMIT $3`,
    [range.startDate, range.endDate, Math.min(Math.max(Number(limit) || 8, 1), 20)],
  );
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  return rows.map((r) => ({
    category_name: r.category_name,
    revenue: money(r.revenue),
    units: Math.round(Number(r.units) * 100) / 100,
    share_pct: total > 0 ? Math.round((Number(r.revenue) / total) * 1000) / 10 : 0,
  }));
}

module.exports = {
  getNetProfitTrends,
  getTopProducts,
  getWorstProducts,
  getTopSuppliers,
  getWorstSuppliers,
  getTopCustomers,
  getAtRiskCustomers,
  getEmployeePerformance,
  getPeakHours,
  getPeakDays,
  getPeakHeatmap,
  getPeakMonths,
  getProductSeasonality,
  getKPIs,
  getSparkline,
  getDailySnapshot,
  getSalesTimeline,
  getCategoryBreakdown,
  parseDateRange,
  previousRange,
  percentChange,
};
