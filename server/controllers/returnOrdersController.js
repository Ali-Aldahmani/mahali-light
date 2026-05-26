const { query } = require('../db/postgres');
const { ok, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const ORDER_SELECT = `
  SELECT o.*,
         c.name AS customer_name, c.phone AS customer_phone,
         s.name AS supplier_name,
         i.invoice_number AS original_invoice_number,
         ri.invoice_number AS replacement_invoice_number,
         po.po_number AS original_po_number,
         u.username AS employee_username,
         rq.request_number AS request_number,
         rq.requested_by AS requested_by,
         req_u.username AS requested_by_username
    FROM return_orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    LEFT JOIN invoices i ON i.id = o.original_invoice_id
    LEFT JOIN invoices ri ON ri.id = o.replacement_invoice_id
    LEFT JOIN purchase_orders po ON po.id = o.original_po_id
    LEFT JOIN users u ON u.id = o.employee_id
    LEFT JOIN return_requests rq ON rq.id = o.return_request_id
    LEFT JOIN users req_u ON req_u.id = rq.requested_by
`;

function shapeOrder(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    returnOrderNumber: row.return_order_number,
    returnRequestId: row.return_request_id,
    requestNumber: row.request_number || null,
    requestedBy: row.requested_by || null,
    requestedByUsername: row.requested_by_username || null,
    returnType: row.return_type,
    customerId: row.customer_id,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || null,
    originalInvoiceId: row.original_invoice_id,
    originalInvoiceNumber: row.original_invoice_number || null,
    replacementInvoiceId: row.replacement_invoice_id,
    replacementInvoiceNumber: row.replacement_invoice_number || null,
    originalPoId: row.original_po_id,
    originalPoNumber: row.original_po_number || null,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username || null,
    totalValue: Number(row.total_value || 0),
    refundTotal: Number(row.refund_total || 0),
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    ...extra,
  };
}

function shapeItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    unitLabel: row.unit_label,
    unitPrice: Number(row.unit_price),
    totalValue: Number(row.total_value),
    condition: row.condition,
    stockAction: row.stock_action,
    serialNumber: row.serial_number,
    warrantyId: row.warranty_id,
  };
}

function shapeRefund(row) {
  return {
    id: row.id,
    method: row.method,
    amount: Number(row.amount),
    bankAccountId: row.bank_account_id,
    employeeId: row.employee_id,
    timestamp: row.timestamp,
    notes: row.notes,
  };
}

async function list(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);

    const parts = [];
    const params = [];
    let i = 1;
    if (req.query.return_type) {
      parts.push(`o.return_type = $${i++}`);
      params.push(req.query.return_type);
    }
    if (req.query.customer_id) {
      parts.push(`o.customer_id = $${i++}`);
      params.push(req.query.customer_id);
    }
    if (req.query.supplier_id) {
      parts.push(`o.supplier_id = $${i++}`);
      params.push(req.query.supplier_id);
    }
    if (req.query.from) {
      parts.push(`o.created_at >= $${i++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      parts.push(`o.created_at <= $${i++}`);
      params.push(req.query.to);
    }
    if (req.query.search) {
      parts.push(
        `(o.return_order_number ILIKE $${i} OR c.name ILIKE $${i}
          OR s.name ILIKE $${i} OR i.invoice_number ILIKE $${i})`,
      );
      params.push(`%${req.query.search}%`);
      i++;
    }
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

    const { rows } = await query(
      `${ORDER_SELECT} ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total FROM return_orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN suppliers s ON s.id = o.supplier_id
         LEFT JOIN invoices i ON i.id = o.original_invoice_id
         ${where}`,
      params,
    );
    return ok(res, rows.map((r) => shapeOrder(r)), {
      total: totals[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${ORDER_SELECT} WHERE o.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const { rows: items } = await query(
      `SELECT * FROM return_order_items WHERE return_order_id = $1
        ORDER BY id ASC`,
      [req.params.id],
    );
    const { rows: refunds } = await query(
      `SELECT * FROM refund_payments WHERE return_order_id = $1
        ORDER BY timestamp ASC`,
      [req.params.id],
    );
    return ok(res, {
      ...shapeOrder(rows[0]),
      items: items.map(shapeItem),
      refundPayments: refunds.map(shapeRefund),
    });
  } catch (err) {
    next(err);
  }
}

async function summary(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE created_at >= date_trunc('month', CURRENT_DATE)
         )::int AS this_month,
         COALESCE(SUM(total_value),0)::numeric AS total_value,
         COALESCE(SUM(refund_total),0)::numeric AS total_refunded
       FROM return_orders`,
    );
    return ok(res, {
      total: rows[0].total,
      thisMonth: rows[0].this_month,
      totalValue: Number(rows[0].total_value),
      totalRefunded: Number(rows[0].total_refunded),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, summary };
