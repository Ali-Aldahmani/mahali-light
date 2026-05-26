const { query } = require('../db/postgres');

// Aggregates everything currently waiting on a manager / admin's approval.
// One round-trip per call so the approvals page stays snappy.
async function getCounts() {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM return_requests WHERE status = 'pending')           AS returns,
       (SELECT COUNT(*)::int FROM invoice_edit_requests WHERE status = 'pending')     AS invoice_edits,
       (SELECT COUNT(*)::int FROM stock_adjustment_requests WHERE status = 'pending') AS stock_adjustments,
       (SELECT COUNT(*)::int FROM stock_counts WHERE status = 'submitted')            AS stock_counts,
       (SELECT COUNT(*)::int FROM attendance_corrections WHERE status = 'pending')    AS attendance_corrections,
       (SELECT COUNT(*)::int FROM leaves WHERE status = 'pending')                    AS leaves`,
  );
  const r = rows[0] || {};
  const total =
    (r.returns || 0) +
    (r.invoice_edits || 0) +
    (r.stock_adjustments || 0) +
    (r.stock_counts || 0) +
    (r.attendance_corrections || 0) +
    (r.leaves || 0);
  return {
    total,
    returns: r.returns || 0,
    invoice_edits: r.invoice_edits || 0,
    stock_adjustments: r.stock_adjustments || 0,
    stock_counts: r.stock_counts || 0,
    attendance_corrections: r.attendance_corrections || 0,
    leaves: r.leaves || 0,
  };
}

// Detailed queue used by the approvals page. Limits each section so we
// don't ship 1000-row payloads down the wire.
async function getQueue({ limit = 10 } = {}) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  const [returns, invoiceEdits, adjustments, counts, corrections, leaves] =
    await Promise.all([
      query(
        `SELECT rr.id, rr.request_number, rr.return_type, rr.requested_at,
                rr.no_invoice_return, rr.reason, c.name AS customer_name,
                u.username AS requested_by_name,
                COALESCE(SUM(rri.total_value), 0)::float8 AS total_value
           FROM return_requests rr
           LEFT JOIN return_request_items rri ON rri.return_request_id = rr.id
           LEFT JOIN customers c ON c.id = rr.customer_id
           LEFT JOIN users u ON u.id = rr.requested_by
          WHERE rr.status = 'pending'
          GROUP BY rr.id, c.name, u.username
          ORDER BY rr.requested_at ASC
          LIMIT $1`,
        [lim],
      ),
      query(
        `SELECT er.id, er.requested_at, er.request_note,
                i.invoice_number, i.id AS invoice_id,
                u.username AS requested_by_name
           FROM invoice_edit_requests er
           JOIN invoices i ON i.id = er.invoice_id
           LEFT JOIN users u ON u.id = er.requested_by
          WHERE er.status = 'pending'
          ORDER BY er.requested_at ASC
          LIMIT $1`,
        [lim],
      ),
      query(
        `SELECT sar.id, sar.requested_at, sar.adjustment_type, sar.requested_qty,
                sar.current_qty, sar.difference, sar.reason, p.name AS product_name,
                u.username AS requested_by_name
           FROM stock_adjustment_requests sar
           JOIN products p ON p.id = sar.product_id
           LEFT JOIN users u ON u.id = sar.requested_by
          WHERE sar.status = 'pending'
          ORDER BY sar.requested_at ASC
          LIMIT $1`,
        [lim],
      ),
      query(
        `SELECT sc.id, sc.count_type, sc.submitted_at,
                sc.total_products, sc.matched_count, sc.discrepancy_count,
                u.username AS submitted_by_name
           FROM stock_counts sc
           LEFT JOIN users u ON u.id = sc.submitted_by
          WHERE sc.status = 'submitted'
          ORDER BY sc.submitted_at ASC
          LIMIT $1`,
        [lim],
      ),
      query(
        `SELECT ac.id, ac.attendance_id, ac.reason, ac.request_note,
                ac.requested_by, ac.new_check_in, ac.new_check_out,
                a.date AS attendance_date,
                u.username AS requested_by_name,
                e.name AS employee_name
           FROM attendance_corrections ac
           JOIN attendance a ON a.id = ac.attendance_id
           LEFT JOIN users u ON u.id = ac.requested_by
           LEFT JOIN employees e ON e.id = a.employee_id
          WHERE ac.status = 'pending'
          ORDER BY a.date DESC
          LIMIT $1`,
        [lim],
      ),
      query(
        `SELECT l.id, l.leave_type, l.start_date, l.end_date, l.total_days,
                l.reason, l.created_at,
                e.name AS employee_name
           FROM leaves l
           LEFT JOIN employees e ON e.id = l.employee_id
          WHERE l.status = 'pending'
          ORDER BY l.created_at ASC
          LIMIT $1`,
        [lim],
      ),
    ]);
  return {
    returns: returns.rows,
    invoice_edits: invoiceEdits.rows,
    stock_adjustments: adjustments.rows,
    stock_counts: counts.rows,
    attendance_corrections: corrections.rows,
    leaves: leaves.rows,
  };
}

module.exports = { getCounts, getQueue };
