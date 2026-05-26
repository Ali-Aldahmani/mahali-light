const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

// Schema for create/update. The phone field is optional but unique when set.
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  email: z
    .string()
    .trim()
    .max(100)
    .email()
    .optional()
    .nullable()
    .or(z.literal('')),
  address: z.string().max(2000).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  trnNumber: z
    .string()
    .trim()
    .max(50)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  creditLimit: z.number().nonnegative().optional().default(0),
  notes: z.string().max(4000).optional().nullable(),
});

const updateSchema = createSchema.extend({
  isActive: z.boolean().optional(),
});

function canSeeBalance(req) {
  const perms = req.user?.permissions || [];
  return perms.includes('customer.view_balance') || perms.includes('*');
}

function shapeCustomer(row, opts = {}) {
  const includeBalance = opts.includeBalance !== false;
  const out = {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    companyName: row.company_name,
    trnNumber: row.trn_number,
    creditLimit: Number(row.credit_limit || 0),
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Stats joined in list/getOne SQL.
    totalSpent: row.total_spent != null ? Number(row.total_spent) : 0,
    invoiceCount: row.invoice_count != null ? Number(row.invoice_count) : 0,
    avgOrderValue:
      row.avg_order_value != null ? Number(row.avg_order_value) : 0,
    lastPurchaseDate: row.last_purchase_date,
    lastPaymentDate: row.last_payment_date,
    daysSinceLastPurchase:
      row.days_since_last_purchase != null
        ? Number(row.days_since_last_purchase)
        : null,
    daysSinceLastPayment:
      row.days_since_last_payment != null
        ? Number(row.days_since_last_payment)
        : null,
  };
  if (includeBalance) {
    out.creditBalance = Number(row.credit_balance || 0);
  }
  return out;
}

// Stats join. Phase 6 introduces `invoices`; until then the LATERAL joins
// reference it lazily via `to_regclass`. If the table doesn't exist, we fall
// back to zeros so the API stays stable across phases.
//
// We detect this at startup once and switch between two SQL variants.
let invoicesTableExists = null;
async function detectInvoicesTable() {
  if (invoicesTableExists !== null) return invoicesTableExists;
  const { rows } = await query(
    `SELECT to_regclass('public.invoices') AS exists`,
  );
  invoicesTableExists = rows[0].exists !== null;
  return invoicesTableExists;
}

function statsJoin(hasInvoices) {
  const invoiceJoin = hasInvoices
    ? `LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total), 0) AS total_spent,
                COUNT(*) AS invoice_count,
                MAX(created_at)::date AS last_purchase_date,
                CASE WHEN COUNT(*) > 0
                  THEN COALESCE(SUM(total), 0) / COUNT(*)
                  ELSE 0
                END AS avg_order_value
           FROM invoices WHERE customer_id = c.id AND status NOT IN ('cancelled','draft')
       ) inv_stats ON TRUE`
    : `LEFT JOIN LATERAL (
         SELECT 0::numeric AS total_spent, 0::int AS invoice_count,
                NULL::date AS last_purchase_date,
                0::numeric AS avg_order_value
       ) inv_stats ON TRUE`;

  return `
    ${invoiceJoin}
    LEFT JOIN LATERAL (
      SELECT MAX(payment_date) AS last_payment_date
        FROM customer_payments WHERE customer_id = c.id
    ) pm_stats ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        CASE WHEN inv_stats.last_purchase_date IS NOT NULL
          THEN (CURRENT_DATE - inv_stats.last_purchase_date)::int
        END AS days_since_last_purchase,
        CASE WHEN pm_stats.last_payment_date IS NOT NULL
          THEN (CURRENT_DATE - pm_stats.last_payment_date)::int
        END AS days_since_last_payment
    ) der ON TRUE
  `;
}

async function baseSelectAndJoin() {
  const hasInvoices = await detectInvoicesTable();
  return `
    SELECT c.*,
           inv_stats.total_spent,
           inv_stats.invoice_count,
           inv_stats.last_purchase_date,
           inv_stats.avg_order_value,
           pm_stats.last_payment_date,
           der.days_since_last_purchase,
           der.days_since_last_payment
      FROM customers c
      ${statsJoin(hasInvoices)}
  `;
}

function trnIsValid(trn) {
  if (trn == null || trn === '') return true;
  return /^\d{15}$/.test(String(trn).trim());
}

async function ensurePhoneUnique(phone, ignoreId = null) {
  if (!phone) return;
  const { rows } = await query(
    `SELECT id FROM customers WHERE phone = $1 ${
      ignoreId ? 'AND id <> $2' : ''
    } LIMIT 1`,
    ignoreId ? [phone, ignoreId] : [phone],
  );
  if (rows.length) {
    throw new AppError(
      ERROR_CODES.VAL_DUPLICATE_PHONE,
      'A customer with this phone number already exists.',
      { status: 409, details: { phone } },
    );
  }
}

// CRUD ---------------------------------------------------------------------

async function list(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];

    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(
        `(c.name ILIKE $${i} OR c.phone ILIKE $${i} OR c.company_name ILIKE $${i} OR c.email ILIKE $${i})`,
      );
    }
    if (req.query.hasBalance === 'true' || req.query.hasBalance === '1') {
      where.push(`c.credit_balance > 0`);
    }
    if (req.query.isActive !== undefined && req.query.isActive !== '') {
      params.push(req.query.isActive === 'true' || req.query.isActive === '1');
      where.push(`c.is_active = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM customers c ${whereSql}`,
      params,
    );

    const base = await baseSelectAndJoin();
    params.push(limit, offset);
    const { rows } = await query(
      `${base}
       ${whereSql}
       ORDER BY c.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Roll-ups for the summary cards. We always count all (regardless of the
    // current filters) so the dashboard shows global numbers.
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total_customers,
              COUNT(*) FILTER (WHERE credit_balance > 0)::int AS with_balance,
              COALESCE(SUM(credit_balance), 0)::numeric AS total_outstanding,
              COUNT(*) FILTER (
                WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
              )::int AS new_this_month
         FROM customers
        WHERE is_active = true`,
    );

    return ok(res, rows.map((r) => shapeCustomer(r, { includeBalance })), {
      page,
      limit,
      total: countRows[0].total,
      totals: {
        totalCustomers: totals[0].total_customers,
        customersWithBalance: totals[0].with_balance,
        totalOutstanding: includeBalance
          ? Number(totals[0].total_outstanding)
          : null,
        newThisMonth: totals[0].new_this_month,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    const base = await baseSelectAndJoin();
    const { rows } = await query(`${base} WHERE c.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    return ok(res, shapeCustomer(rows[0], { includeBalance }));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});

    if (!trnIsValid(body.trnNumber)) {
      throw new AppError(
        ERROR_CODES.VAL_INVALID_TRN,
        'TRN must be exactly 15 digits.',
        { status: 400, details: { field: 'trnNumber' } },
      );
    }
    if (body.phone) await ensurePhoneUnique(body.phone);

    const { rows } = await query(
      `INSERT INTO customers
         (name, phone, email, address, company_name, trn_number,
          credit_limit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        body.name,
        body.phone,
        body.email || null,
        body.address || null,
        body.companyName || null,
        body.trnNumber,
        body.creditLimit ?? 0,
        body.notes || null,
        req.user.id,
      ],
    );
    const id = rows[0].id;

    await logActivity({
      entityType: 'customer',
      entityId: id,
      action: 'customer.created',
      performedBy: req.user.id,
      notes: body.name,
    });

    const base = await baseSelectAndJoin();
    const { rows: full } = await query(`${base} WHERE c.id = $1`, [id]);
    return created(res, shapeCustomer(full[0], { includeBalance: true }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    const { id } = req.params;
    const body = updateSchema.parse(req.body || {});

    const { rows: existing } = await query(
      `SELECT * FROM customers WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }

    if (!trnIsValid(body.trnNumber)) {
      throw new AppError(
        ERROR_CODES.VAL_INVALID_TRN,
        'TRN must be exactly 15 digits.',
        { status: 400, details: { field: 'trnNumber' } },
      );
    }
    if (body.phone) await ensurePhoneUnique(body.phone, id);

    const prevLimit = Number(existing[0].credit_limit || 0);
    const newLimit = Number(body.creditLimit ?? prevLimit);

    await query(
      `UPDATE customers
          SET name = $1,
              phone = $2,
              email = $3,
              address = $4,
              company_name = $5,
              trn_number = $6,
              credit_limit = $7,
              notes = $8,
              is_active = COALESCE($9, is_active),
              updated_at = NOW()
        WHERE id = $10`,
      [
        body.name,
        body.phone,
        body.email || null,
        body.address || null,
        body.companyName || null,
        body.trnNumber,
        newLimit,
        body.notes || null,
        body.isActive,
        id,
      ],
    );

    await logActivity({
      entityType: 'customer',
      entityId: id,
      action: 'customer.updated',
      performedBy: req.user.id,
    });
    if (Math.abs(prevLimit - newLimit) > 0.001) {
      await logActivity({
        entityType: 'customer',
        entityId: id,
        action: 'customer.credit_limit_updated',
        performedBy: req.user.id,
        oldValue: { creditLimit: prevLimit },
        newValue: { creditLimit: newLimit },
      });
    }

    const base = await baseSelectAndJoin();
    const { rows: full } = await query(`${base} WHERE c.id = $1`, [id]);
    return ok(res, shapeCustomer(full[0], { includeBalance }));
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, name, credit_balance, is_active FROM customers WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    const balance = Number(rows[0].credit_balance || 0);
    if (balance > 0.001) {
      throw new AppError(
        ERROR_CODES.BIZ_OUTSTANDING_BALANCE,
        `Customer has outstanding balance of ${balance.toFixed(2)} AED. Collect payment before deactivating.`,
        { status: 409, details: { balance } },
      );
    }

    await query(
      `UPDATE customers SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    await logActivity({
      entityType: 'customer',
      entityId: id,
      action: 'customer.deleted',
      performedBy: req.user.id,
      notes: rows[0].name,
    });

    return ok(res, { id, isActive: false });
  } catch (err) {
    next(err);
  }
}

// Search ------------------------------------------------------------------

async function search(req, res, next) {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return ok(res, []);
    const limit = Math.min(50, Number(req.query.limit) || 10);
    const includeBalance = canSeeBalance(req);

    // Phone matches favor exact / starts-with. Name uses trigram via ILIKE
    // (Postgres can use the gin_trgm index for `name ILIKE '%foo%'`).
    const term = `%${q}%`;
    const phonePrefix = q.replace(/[^\d+]/g, '');

    const params = [term, term];
    let phoneCondition = '';
    if (phonePrefix) {
      params.push(`${phonePrefix}%`);
      phoneCondition = `OR c.phone LIKE $${params.length}`;
    }
    params.push(limit);

    const { rows } = await query(
      `SELECT c.id, c.name, c.phone, c.company_name, c.credit_balance,
              c.credit_limit, c.is_active
         FROM customers c
        WHERE c.is_active = true
          AND (
            c.name ILIKE $1
            OR c.company_name ILIKE $2
            ${phoneCondition}
          )
        ORDER BY
          CASE WHEN c.phone = $1 THEN 0 ELSE 1 END,
          c.name ASC
        LIMIT $${params.length}`,
      params,
    );

    return ok(
      res,
      rows.map((r) => {
        const o = {
          id: r.id,
          name: r.name,
          phone: r.phone,
          companyName: r.company_name,
          creditLimit: Number(r.credit_limit || 0),
        };
        if (includeBalance) o.creditBalance = Number(r.credit_balance || 0);
        return o;
      }),
    );
  } catch (err) {
    next(err);
  }
}

// Outstanding receivables -------------------------------------------------

async function outstanding(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    if (!includeBalance) {
      throw new AppError(
        ERROR_CODES.AUTH_NO_PERMISSION,
        'You need customer.view_balance to view receivables.',
        { status: 403 },
      );
    }
    const { rows } = await query(
      `SELECT c.id, c.name, c.phone, c.company_name, c.credit_balance,
              c.credit_limit,
              pm.last_payment_date,
              CASE WHEN pm.last_payment_date IS NOT NULL
                THEN (CURRENT_DATE - pm.last_payment_date)::int
              END AS days_since_last_payment
         FROM customers c
         LEFT JOIN LATERAL (
           SELECT MAX(payment_date) AS last_payment_date
             FROM customer_payments WHERE customer_id = c.id
         ) pm ON TRUE
        WHERE c.is_active = true AND c.credit_balance > 0
        ORDER BY c.credit_balance DESC`,
    );

    const total = rows.reduce((s, r) => s + Number(r.credit_balance || 0), 0);

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        companyName: r.company_name,
        creditBalance: Number(r.credit_balance),
        creditLimit: Number(r.credit_limit || 0),
        lastPaymentDate: r.last_payment_date,
        daysSinceLastPayment: r.days_since_last_payment,
      })),
      { totals: { totalOutstanding: Math.round(total * 100) / 100, count: rows.length } },
    );
  } catch (err) {
    next(err);
  }
}

// Profile sub-resources ---------------------------------------------------

async function listInvoices(req, res, next) {
  try {
    const has = await detectInvoicesTable();
    if (!has) return ok(res, []);
    const { rows } = await query(
      `SELECT * FROM invoices WHERE customer_id = $1
        ORDER BY created_at DESC`,
      [req.params.id],
    );
    return ok(res, rows);
  } catch (err) {
    next(err);
  }
}

async function listPayments(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT p.*, u.username AS employee_username
         FROM customer_payments p
         LEFT JOIN users u ON u.id = p.employee_id
        WHERE p.customer_id = $1
        ORDER BY p.payment_date DESC, p.created_at DESC`,
      [req.params.id],
    );
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        invoiceId: r.invoice_id,
        amount: Number(r.amount),
        paymentMethod: r.payment_method,
        bankAccountId: r.bank_account_id,
        paymentDate: r.payment_date,
        employeeUsername: r.employee_username,
        notes: r.notes,
        createdAt: r.created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

async function listReturns(_req, res, _next) {
  // Phase 9 will populate this; we return an empty array gracefully.
  return ok(res, []);
}

async function listWarranties(_req, res, _next) {
  // Phase 8 will populate this; we return an empty array gracefully.
  return ok(res, []);
}

async function listTimeline(req, res, next) {
  try {
    const customerId = req.params.id;
    const hasInvoices = await detectInvoicesTable();

    const parts = [];
    parts.push(`(
      SELECT 'payment_collected' AS event, p.created_at AS at,
             p.id::text AS ref,
             COALESCE(u.username, 'system') AS employee,
             p.amount::numeric AS amount,
             p.payment_method AS status,
             NULL::text AS label
        FROM customer_payments p
        LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.customer_id = $1
    )`);

    parts.push(`(
      SELECT 'profile_updated' AS event, al.timestamp AS at,
             al.id::text AS ref,
             COALESCE(u.username, 'system') AS employee,
             NULL::numeric AS amount,
             al.action AS status,
             al.notes AS label
        FROM activity_log al
        LEFT JOIN users u ON u.id = al.performed_by
       WHERE al.entity_type = 'customer'
         AND al.entity_id = $1
         AND al.action IN ('customer.updated','customer.credit_limit_updated','customer.created')
    )`);

    if (hasInvoices) {
      parts.push(`(
        SELECT 'invoice_created' AS event, i.created_at AS at,
               i.id::text AS ref,
               COALESCE(u.username, 'system') AS employee,
               i.total::numeric AS amount,
               i.status AS status,
               i.invoice_number AS label
          FROM invoices i
          LEFT JOIN users u ON u.id = i.employee_id
         WHERE i.customer_id = $1
      )`);
    }

    const sql = `${parts.join(' UNION ALL ')} ORDER BY at DESC NULLS LAST LIMIT 200`;
    const { rows } = await query(sql, [customerId]);

    const canSee = canSeeBalance(req);
    return ok(
      res,
      rows.map((r) => ({
        event: r.event,
        at: r.at,
        referenceId: r.ref,
        employeeUsername: r.employee,
        amount: r.amount == null ? null : canSee ? Number(r.amount) : null,
        status: r.status,
        label: r.label,
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
  search,
  outstanding,
  listInvoices,
  listPayments,
  listReturns,
  listWarranties,
  listTimeline,
};
