const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactPerson: z.string().max(100).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().max(100).optional().nullable().or(z.literal('')),
  address: z.string().max(2000).optional().nullable(),
  paymentTerms: z.string().max(100).optional().nullable(),
  defaultLeadTimeDays: z.number().int().min(0).max(365).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const updateSchema = createSchema.extend({
  isActive: z.boolean().optional(),
});

function shapeSupplier(row) {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTerms: row.payment_terms,
    defaultLeadTimeDays: row.default_lead_time_days,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Stats are computed in list/getOne SQL when joined.
    totalSpent: row.total_spent != null ? Number(row.total_spent) : 0,
    outstandingBalance:
      row.outstanding_balance != null ? Number(row.outstanding_balance) : 0,
    lastOrderDate: row.last_order_date,
    lastPaymentDate: row.last_payment_date,
    totalOrders: row.total_orders != null ? Number(row.total_orders) : 0,
    overdueCount: row.overdue_count != null ? Number(row.overdue_count) : 0,
    avgLeadTimeDays:
      row.avg_lead_time_days != null ? Number(row.avg_lead_time_days) : null,
    defectRate: row.defect_rate != null ? Number(row.defect_rate) : null,
  };
}

// Reusable SQL fragment that joins live stats onto a supplier row.
const STATS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(total_cost), 0) AS total_spent,
      COALESCE(SUM(balance_due), 0) AS outstanding_balance,
      COUNT(*) AS total_orders,
      MAX(order_date) AS last_order_date,
      COUNT(*) FILTER (
        WHERE due_date IS NOT NULL
          AND due_date < CURRENT_DATE
          AND payment_status <> 'paid'
          AND status <> 'cancelled'
      ) AS overdue_count,
      AVG(
        CASE WHEN received_date IS NOT NULL
          THEN (received_date - order_date)::numeric
          ELSE NULL
        END
      ) AS avg_lead_time_days
      FROM purchase_orders WHERE supplier_id = s.id AND status <> 'cancelled'
  ) po_stats ON TRUE
  LEFT JOIN LATERAL (
    SELECT MAX(payment_date) AS last_payment_date
      FROM supplier_payments WHERE supplier_id = s.id
  ) pm_stats ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN SUM(quantity)::numeric > 0
        THEN (SUM(CASE WHEN condition = 'defective' THEN quantity ELSE 0 END)
              * 100.0 / SUM(quantity))
        ELSE NULL
      END AS defect_rate
      FROM supplier_return_items sri
      JOIN supplier_returns sr ON sr.id = sri.supplier_return_id
     WHERE sr.supplier_id = s.id
  ) ret_stats ON TRUE
`;

const BASE_SELECT = `
  SELECT s.*,
         po_stats.total_spent,
         po_stats.outstanding_balance,
         po_stats.total_orders,
         po_stats.last_order_date,
         po_stats.overdue_count,
         po_stats.avg_lead_time_days,
         pm_stats.last_payment_date,
         ret_stats.defect_rate
    FROM suppliers s
    ${STATS_JOIN}
`;

async function list(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(
        `(s.name ILIKE $${i} OR s.contact_person ILIKE $${i} OR s.phone ILIKE $${i} OR s.email ILIKE $${i})`,
      );
    }
    if (req.query.isActive !== undefined && req.query.isActive !== '') {
      params.push(req.query.isActive === 'true' || req.query.isActive === '1');
      where.push(`s.is_active = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM suppliers s ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${BASE_SELECT}
       ${whereSql}
       ORDER BY s.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Roll-ups for the summary cards.
    const { rows: totals } = await query(
      `SELECT
         COUNT(*)::int AS total_suppliers,
         COALESCE(SUM(po_stats.outstanding_balance), 0)::numeric AS total_outstanding,
         COALESCE(SUM(po_stats.overdue_count), 0)::int AS total_overdue
         FROM suppliers s
         ${STATS_JOIN}
        WHERE s.is_active = true`,
    );

    return ok(res, rows.map(shapeSupplier), {
      page,
      limit,
      total: countRows[0].total,
      totals: {
        totalSuppliers: totals[0].total_suppliers,
        totalOutstanding: Number(totals[0].total_outstanding),
        overdueCount: totals[0].total_overdue,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(`${BASE_SELECT} WHERE s.id = $1`, [
      req.params.id,
    ]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, shapeSupplier(rows[0]));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const { rows } = await query(
      `INSERT INTO suppliers
         (name, contact_person, phone, email, address, payment_terms,
          default_lead_time_days, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        body.name,
        body.contactPerson || null,
        body.phone || null,
        body.email || null,
        body.address || null,
        body.paymentTerms || null,
        body.defaultLeadTimeDays ?? null,
        body.notes || null,
        req.user.id,
      ],
    );
    const id = rows[0].id;

    await logActivity({
      entityType: 'supplier',
      entityId: id,
      action: 'supplier.created',
      performedBy: req.user.id,
      notes: body.name,
    });

    const { rows: full } = await query(`${BASE_SELECT} WHERE s.id = $1`, [id]);
    return created(res, shapeSupplier(full[0]));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const body = updateSchema.parse(req.body || {});

    const { rows: existing } = await query(`SELECT * FROM suppliers WHERE id = $1`, [
      id,
    ]);
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await query(
      `UPDATE suppliers
          SET name = $1,
              contact_person = $2,
              phone = $3,
              email = $4,
              address = $5,
              payment_terms = $6,
              default_lead_time_days = $7,
              notes = $8,
              is_active = COALESCE($9, is_active),
              updated_at = NOW()
        WHERE id = $10`,
      [
        body.name,
        body.contactPerson || null,
        body.phone || null,
        body.email || null,
        body.address || null,
        body.paymentTerms || null,
        body.defaultLeadTimeDays ?? null,
        body.notes || null,
        body.isActive,
        id,
      ],
    );

    await logActivity({
      entityType: 'supplier',
      entityId: id,
      action: 'supplier.updated',
      performedBy: req.user.id,
    });

    const { rows: full } = await query(`${BASE_SELECT} WHERE s.id = $1`, [id]);
    return ok(res, shapeSupplier(full[0]));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;

    // Block soft-delete if there are any POs (even cancelled ones — they
    // still reference the supplier).
    const { rows: poCount } = await query(
      `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE supplier_id = $1`,
      [id],
    );
    if (poCount[0].c > 0) {
      throw new AppError(
        ERROR_CODES.RESOURCE_IN_USE,
        `Supplier has ${poCount[0].c} purchase order${poCount[0].c === 1 ? '' : 's'} and cannot be deleted.`,
        { status: 409, details: { purchaseOrders: poCount[0].c } },
      );
    }

    const { rowCount } = await query(
      `UPDATE suppliers SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await logActivity({
      entityType: 'supplier',
      entityId: id,
      action: 'supplier.deleted',
      performedBy: req.user.id,
    });

    return ok(res, { id, isActive: false });
  } catch (err) {
    next(err);
  }
}

// Profile sub-resources --------------------------------------------------------

async function listPurchaseOrders(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT po.*, COALESCE(item_count.c, 0)::int AS items_count
         FROM purchase_orders po
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS c FROM purchase_order_items WHERE purchase_order_id = po.id
         ) item_count ON TRUE
        WHERE po.supplier_id = $1
        ORDER BY po.order_date DESC, po.created_at DESC`,
      [req.params.id],
    );
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        poNumber: r.po_number,
        supplierId: r.supplier_id,
        orderDate: r.order_date,
        expectedDate: r.expected_date,
        receivedDate: r.received_date,
        dueDate: r.due_date,
        status: r.status,
        paymentStatus: r.payment_status,
        subtotal: Number(r.subtotal),
        totalCost: Number(r.total_cost),
        amountPaid: Number(r.amount_paid),
        balanceDue: Number(r.balance_due),
        itemsCount: r.items_count,
        notes: r.notes,
        attachmentPath: r.attachment_path,
      })),
    );
  } catch (err) {
    next(err);
  }
}

async function listPayments(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.*, u.username AS employee_username, po.po_number
         FROM supplier_payments p
         LEFT JOIN users u ON u.id = p.employee_id
         LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
        WHERE p.supplier_id = $1
        ORDER BY p.payment_date DESC, p.created_at DESC`,
      [req.params.id],
    );
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        purchaseOrderId: r.purchase_order_id,
        poNumber: r.po_number,
        supplierId: r.supplier_id,
        amount: Number(r.amount),
        paymentMethod: r.payment_method,
        paymentDate: r.payment_date,
        employeeUsername: r.employee_username,
        receiptAttachment: r.receipt_attachment,
        notes: r.notes,
        createdAt: r.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

async function listProducts(req, res, next) {
  try {
    const includeCost = (req.user?.permissions || []).includes('product.view_cost');

    const { rows } = await query(
      `WITH cost_data AS (
         SELECT product_id, variant_id, supplier_id,
                cost_price, date,
                ROW_NUMBER() OVER (PARTITION BY variant_id ORDER BY date DESC, created_at DESC) AS rn
           FROM product_cost_history
          WHERE supplier_id = $1
       ),
       agg AS (
         SELECT product_id, variant_id, COUNT(*)::int AS purchases,
                SUM(quantity_bought)::numeric AS total_units,
                MAX(date) AS last_date
           FROM product_cost_history
          WHERE supplier_id = $1
          GROUP BY product_id, variant_id
       )
       SELECT cd.product_id, cd.variant_id, cd.cost_price AS latest_cost,
              prev.cost_price AS previous_cost,
              agg.purchases, agg.total_units, agg.last_date,
              p.name AS product_name, p.image_path AS product_image, p.unit_label,
              v.sku, v.internal_barcode AS barcode
         FROM cost_data cd
         JOIN agg ON agg.variant_id = cd.variant_id
         LEFT JOIN cost_data prev ON prev.variant_id = cd.variant_id AND prev.rn = 2
         JOIN products p ON p.id = cd.product_id
         JOIN product_variants v ON v.id = cd.variant_id
        WHERE cd.rn = 1
        ORDER BY agg.last_date DESC`,
      [req.params.id],
    );

    return ok(
      res,
      rows.map((r) => {
        const out = {
          productId: r.product_id,
          variantId: r.variant_id,
          productName: r.product_name,
          productImage: r.product_image,
          sku: r.sku,
          barcode: r.barcode,
          unitLabel: r.unit_label,
          totalUnitsBought: Number(r.total_units),
          purchaseCount: r.purchases,
          lastOrderDate: r.last_date,
        };
        if (includeCost) {
          out.latestCost = Number(r.latest_cost);
          out.previousCost =
            r.previous_cost == null ? null : Number(r.previous_cost);
        }
        return out;
      }),
    );
  } catch (err) {
    next(err);
  }
}

async function listReturns(req, res, next) {
  try {
    const supplierId = req.params.id;
    // Phase 4 supplier_returns (receive-stage adjustments).
    const { rows: legacyRows } = await query(
      `SELECT sr.*, COALESCE(ic.c, 0)::int AS items_count,
              u.username AS employee_username
         FROM supplier_returns sr
         LEFT JOIN users u ON u.id = sr.employee_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS c FROM supplier_return_items WHERE supplier_return_id = sr.id
         ) ic ON TRUE
        WHERE sr.supplier_id = $1
        ORDER BY sr.return_date DESC, sr.created_at DESC`,
      [supplierId],
    );

    // Phase 9 return requests targeting this supplier.
    const { rows: requestRows } = await query(
      `SELECT r.*,
              po.po_number AS po_number,
              po.id AS po_id,
              u.username AS requested_by_username,
              ro.id AS return_order_id,
              ro.return_order_number AS return_order_number,
              (SELECT COALESCE(SUM(total_value),0)::numeric
                 FROM return_request_items ri
                WHERE ri.return_request_id = r.id) AS total_value,
              (SELECT COUNT(*)::int FROM return_request_items ri
                WHERE ri.return_request_id = r.id) AS item_count
         FROM return_requests r
         LEFT JOIN purchase_orders po ON po.id = r.reference_id
              AND r.reference_type = 'purchase_order'
         LEFT JOIN users u ON u.id = r.requested_by
         LEFT JOIN return_orders ro ON ro.return_request_id = r.id
        WHERE r.supplier_id = $1
          AND r.return_type = 'supplier_return'
        ORDER BY r.requested_at DESC`,
      [supplierId],
    );

    return ok(res, {
      legacy: legacyRows.map((r) => ({
        id: r.id,
        returnNumber: r.return_number,
        purchaseOrderId: r.purchase_order_id,
        returnDate: r.return_date,
        reason: r.reason,
        status: r.status,
        resolution: r.resolution,
        resolutionNotes: r.resolution_notes,
        totalValue: Number(r.total_value),
        itemsCount: r.items_count,
        employeeUsername: r.employee_username,
      })),
      requests: requestRows.map((r) => ({
        id: r.id,
        requestNumber: r.request_number,
        status: r.status,
        reason: r.reason,
        requestedAt: r.requested_at,
        reviewedAt: r.reviewed_at,
        executedAt: r.executed_at,
        totalValue: Number(r.total_value || 0),
        itemCount: r.item_count,
        poId: r.po_id,
        poNumber: r.po_number,
        returnOrderId: r.return_order_id,
        returnOrderNumber: r.return_order_number,
        requestedByUsername: r.requested_by_username,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function listTimeline(req, res, next) {
  try {
    const includeCost = (req.user?.permissions || []).includes('product.view_cost');
    const supplierId = req.params.id;

    // Union POs / payments / returns into a single chronological feed.
    const { rows } = await query(
      `(
        SELECT 'po_created' AS event, po.created_at AS at,
               po.id::text AS ref, po.po_number AS label,
               po.total_cost AS amount, po.status AS status,
               u.username AS employee
          FROM purchase_orders po
          LEFT JOIN users u ON u.id = po.employee_id
         WHERE po.supplier_id = $1
       )
       UNION ALL
       (
        SELECT 'po_received' AS event, po.received_date::timestamptz AS at,
               po.id::text AS ref, po.po_number AS label,
               po.total_cost AS amount, po.status AS status,
               u.username AS employee
          FROM purchase_orders po
          LEFT JOIN users u ON u.id = po.employee_id
         WHERE po.supplier_id = $1
           AND po.received_date IS NOT NULL
       )
       UNION ALL
       (
        SELECT 'payment_added' AS event, sp.created_at AS at,
               sp.id::text AS ref,
               COALESCE(po.po_number, '') AS label,
               sp.amount AS amount, sp.payment_method AS status,
               u.username AS employee
          FROM supplier_payments sp
          LEFT JOIN purchase_orders po ON po.id = sp.purchase_order_id
          LEFT JOIN users u ON u.id = sp.employee_id
         WHERE sp.supplier_id = $1
       )
       UNION ALL
       (
        SELECT 'return_created' AS event, sr.created_at AS at,
               sr.id::text AS ref, sr.return_number AS label,
               sr.total_value AS amount, sr.status AS status,
               u.username AS employee
          FROM supplier_returns sr
          LEFT JOIN users u ON u.id = sr.employee_id
         WHERE sr.supplier_id = $1
       )
       ORDER BY at DESC NULLS LAST
       LIMIT 200`,
      [supplierId],
    );

    return ok(
      res,
      rows.map((r) => ({
        event: r.event,
        at: r.at,
        referenceId: r.ref,
        label: r.label,
        status: r.status,
        employeeUsername: r.employee,
        amount: includeCost || r.event === 'payment_added' ? Number(r.amount) : null,
      })),
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  listPurchaseOrders,
  listPayments,
  listProducts,
  listReturns,
  listTimeline,
};
