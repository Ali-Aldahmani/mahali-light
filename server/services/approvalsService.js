const { query } = require('../db/postgres');

// Which permission lets a caller act on (and therefore see) each queue
// section — mirrors the requirePermission() gate on that section's own
// approve/reject route. A caller with none of these still gets 200s (this
// is a summary widget, not an approval action) but every section they
// can't act on comes back empty rather than leaking other departments'
// pending requests/financial totals to them.
const SECTION_PERMISSION = {
  returns: 'return.approve',
  invoice_edits: 'invoice.edit_approve',
  stock_adjustments: 'stock.adjust_approve',
  stock_counts: 'stock.count_approve',
  attendance_corrections: 'attendance.correction_approve',
  leaves: 'attendance.correction_approve',
};

function allowedSections(permissions = []) {
  const has = (p) => permissions.includes(p) || permissions.includes('*');
  return Object.fromEntries(
    Object.entries(SECTION_PERMISSION).map(([section, perm]) => [section, has(perm)]),
  );
}

// Aggregates everything currently waiting on a manager / admin's approval.
// One round-trip per call so the approvals page stays snappy.
async function getCounts(permissions = []) {
  const allowed = allowedSections(permissions);
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
  const section = (key) => (allowed[key] ? r[key] || 0 : 0);
  const counts = {
    returns: section('returns'),
    invoice_edits: section('invoice_edits'),
    stock_adjustments: section('stock_adjustments'),
    stock_counts: section('stock_counts'),
    attendance_corrections: section('attendance_corrections'),
    leaves: section('leaves'),
  };
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { total, ...counts };
}

const EMPTY_QUEUE = {
  returns: [],
  invoice_edits: [],
  stock_adjustments: [],
  stock_counts: [],
  attendance_corrections: [],
  leaves: [],
};

// Detailed queue used by the approvals page. Limits each section so we
// don't ship 1000-row payloads down the wire. Sections the caller can't
// approve are never queried — not just filtered after the fact — so a
// user with zero approval permissions can't pull anyone else's queue data
// through this endpoint.
async function getQueue({ limit = 10, permissions = [] } = {}) {
  const allowed = allowedSections(permissions);
  if (!Object.values(allowed).some(Boolean)) return EMPTY_QUEUE;
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  const [returns, invoiceEdits, adjustments, counts, corrections, leaves] =
    await Promise.all([
      allowed.returns ? query(
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
      ) : Promise.resolve({ rows: [] }),
      allowed.invoice_edits ? query(
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
      ) : Promise.resolve({ rows: [] }),
      allowed.stock_adjustments ? query(
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
      ) : Promise.resolve({ rows: [] }),
      allowed.stock_counts ? query(
        `SELECT sc.id, sc.count_type, sc.submitted_at,
                sc.total_products, sc.matched_count, sc.discrepancy_count,
                u.username AS submitted_by_name
           FROM stock_counts sc
           LEFT JOIN users u ON u.id = sc.submitted_by
          WHERE sc.status = 'submitted'
          ORDER BY sc.submitted_at ASC
          LIMIT $1`,
        [lim],
      ) : Promise.resolve({ rows: [] }),
      allowed.attendance_corrections ? query(
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
      ) : Promise.resolve({ rows: [] }),
      allowed.leaves ? query(
        `SELECT l.id, l.leave_type, l.start_date, l.end_date, l.total_days,
                l.reason, l.created_at,
                e.name AS employee_name
           FROM leaves l
           LEFT JOIN employees e ON e.id = l.employee_id
          WHERE l.status = 'pending'
          ORDER BY l.created_at ASC
          LIMIT $1`,
        [lim],
      ) : Promise.resolve({ rows: [] }),
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
