const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { phoneKey, phoneSearchCore, digitsSql } = require('../utils/phone');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { emitCustomerChanged } = require('../utils/customerEvents');

// Editable fields. Phone is optional but unique when set.
const fieldSchemas = {
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
  creditLimit: z.number().nonnegative().optional(),
  notes: z.string().max(4000).optional().nullable(),
};

const createSchema = z.object({
  ...fieldSchemas,
  creditLimit: fieldSchemas.creditLimit.default(0),
  // Client-generated per form; a retried create returns the first customer.
  requestKey: z.string().trim().min(8).max(128).optional(),
});

// Updates are partial: a field left out keeps its stored value.
// expectedUpdatedAt is the updatedAt the editor loaded; a mismatch means
// someone else saved in between and the request is rejected with 409.
const updateSchema = z.object({
  ...fieldSchemas,
  name: fieldSchemas.name.optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

// API field -> column, with the normalisation used on write and for
// comparing against the stored row.
const blankToNull = (v) => (v === '' || v === undefined ? null : v);
const EDITABLE = [
  ['name', 'name', (v) => v],
  ['phone', 'phone', blankToNull],
  ['email', 'email', blankToNull],
  ['address', 'address', blankToNull],
  ['companyName', 'company_name', blankToNull],
  ['trnNumber', 'trn_number', blankToNull],
  ['creditLimit', 'credit_limit', (v) => Number(v || 0)],
  ['notes', 'notes', blankToNull],
  ['isActive', 'is_active', (v) => v !== false],
];

function storedValue(row, key, column, normalize) {
  const v = row[column];
  if (key === 'creditLimit') return Number(v || 0);
  if (key === 'isActive') return v !== false;
  return normalize(v);
}

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
    createdBy: row.created_by || null,
    createdByUsername: row.created_by_username || null,
    // Stats joined in list/getOne SQL. totalSpent is net: confirmed invoice
    // totals minus refunds paid on customer returns (grossSpent - refundedTotal).
    totalSpent: row.total_spent != null ? Number(row.total_spent) : 0,
    grossSpent: row.gross_spent != null ? Number(row.gross_spent) : 0,
    refundedTotal: row.refunded_total != null ? Number(row.refunded_total) : 0,
    invoiceCount: row.invoice_count != null ? Number(row.invoice_count) : 0,
    avgOrderValue:
      row.avg_order_value != null ? Number(row.avg_order_value) : 0,
    lastPurchaseDate: row.last_purchase_date,
    lastPurchaseAt: row.last_purchase_at || null,
    lastPaymentDate: row.last_payment_date,
    lastPaymentAt: row.last_payment_at || null,
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

// Card definitions (kept in line with the customer reports):
//   gross_spent       confirmed invoices only (drafts and cancellations never
//                     count), tax included
//   refunded_total    refunds paid out on this customer's returns
//   total_spent       gross_spent - refunded_total (net spend)
//   invoice_count     confirmed sales, excluding the zero/difference-value
//                     replacement invoices a return creates
//   avg_order_value   total_spent / invoice_count
//   last_purchase_at  latest confirmation time
//   last_payment_at   latest money actually received: balance collections or
//                     non-credit checkout payments
function statsJoin(hasInvoices) {
  const invoiceJoin = hasInvoices
    ? `LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(i.total), 0) AS gross_spent,
                COUNT(*) FILTER (
                  WHERE NOT EXISTS (
                    SELECT 1 FROM return_orders rr WHERE rr.replacement_invoice_id = i.id
                  )
                ) AS invoice_count,
                MAX(i.confirmed_at) AS last_purchase_at
           FROM invoices i
          WHERE i.customer_id = c.id AND i.status = 'confirmed'
       ) inv_raw ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(ro.refund_total), 0) AS refunded_total
           FROM return_orders ro
          WHERE ro.customer_id = c.id
            AND ro.return_type IN ('customer_refund', 'customer_replace')
       ) ret_stats ON TRUE
       LEFT JOIN LATERAL (
         SELECT inv_raw.gross_spent,
                ret_stats.refunded_total,
                inv_raw.gross_spent - ret_stats.refunded_total AS total_spent,
                inv_raw.invoice_count,
                inv_raw.last_purchase_at,
                inv_raw.last_purchase_at::date AS last_purchase_date,
                CASE WHEN inv_raw.invoice_count > 0
                  THEN (inv_raw.gross_spent - ret_stats.refunded_total) / inv_raw.invoice_count
                  ELSE 0
                END AS avg_order_value
       ) inv_stats ON TRUE`
    : `LEFT JOIN LATERAL (
         SELECT 0::numeric AS gross_spent, 0::numeric AS refunded_total,
                0::numeric AS total_spent, 0::int AS invoice_count,
                NULL::timestamptz AS last_purchase_at,
                NULL::date AS last_purchase_date,
                0::numeric AS avg_order_value
       ) inv_stats ON TRUE`;

  const checkoutPayments = hasInvoices
    ? `UNION ALL
         SELECT MAX(ip.timestamp)
           FROM invoice_payments ip
           JOIN invoices i ON i.id = ip.invoice_id
          WHERE i.customer_id = c.id
            AND i.status NOT IN ('cancelled', 'draft')
            AND ip.method <> 'credit'`
    : '';

  return `
    ${invoiceJoin}
    LEFT JOIN LATERAL (
      SELECT MAX(paid_at) AS last_payment_at,
             MAX(paid_at)::date AS last_payment_date
        FROM (
          SELECT MAX(GREATEST(p.created_at, p.payment_date::timestamptz)) AS paid_at
            FROM customer_payments p WHERE p.customer_id = c.id
          ${checkoutPayments}
        ) paid
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
           cu.username AS created_by_username,
           inv_stats.total_spent,
           inv_stats.gross_spent,
           inv_stats.refunded_total,
           inv_stats.invoice_count,
           inv_stats.last_purchase_date,
           inv_stats.last_purchase_at,
           inv_stats.avg_order_value,
           pm_stats.last_payment_date,
           pm_stats.last_payment_at,
           der.days_since_last_purchase,
           der.days_since_last_payment
      FROM customers c
      LEFT JOIN users cu ON cu.id = c.created_by
      ${statsJoin(hasInvoices)}
  `;
}

function trnIsValid(trn) {
  if (trn == null || trn === '') return true;
  return /^\d{15}$/.test(String(trn).trim());
}

// Same number in any spelling counts: "+971501234567", "0501234567" and
// "00971 50 123 4567" are one customer. Candidates share the last 9 digits;
// the full international key then decides.
// Inside a transaction, an advisory lock on the phone key makes two
// concurrent saves of the same number (in any spelling) run one at a time,
// so the second one sees the first and is rejected.
async function ensurePhoneUnique(client, phone, ignoreId = null) {
  if (!phone) return;
  const key = phoneKey(phone);
  if (!key) return;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `customer_phone:${key}`,
  ]);
  const { rows: candidates } = await client.query(
    `SELECT id, phone FROM customers
      WHERE RIGHT(${digitsSql('phone')}, 9) = RIGHT($1, 9) ${ignoreId ? 'AND id <> $2' : ''}`,
    ignoreId ? [key, ignoreId] : [key],
  );
  const rows = candidates.filter((c) => phoneKey(c.phone) === key);
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
      // A number matches in any stored spelling (050…, +971 50…, 00971…).
      const core = phoneSearchCore(req.query.search);
      let phoneDigits = '';
      if (core) {
        params.push(`%${core}%`);
        phoneDigits = ` OR ${digitsSql('c.phone')} LIKE $${params.length}`;
      }
      where.push(
        `(c.name ILIKE $${i} OR c.phone ILIKE $${i} OR c.company_name ILIKE $${i} OR c.email ILIKE $${i}${phoneDigits})`,
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

// Hover-card summary: who the customer is, what they've spent, what they
// owe, and the last time they paid. "Paid" covers balance payments
// (customer_payments) and money taken on their invoices (invoice_payments,
// excluding "credit", which is on account rather than paid). A split payment
// on one invoice counts as one payment.
function lastPaymentSql(hasInvoices) {
  const invoicePart = hasInvoices
    ? `UNION ALL
       SELECT MAX(ip.timestamp) AS paid_at,
              SUM(ip.amount) AS amount,
              CASE WHEN COUNT(DISTINCT ip.method) > 1 THEN 'split' ELSE MIN(ip.method) END AS method,
              'invoice' AS source
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
        WHERE i.customer_id = $1
          AND i.status NOT IN ('cancelled', 'draft')
          AND ip.method <> 'credit'
        GROUP BY ip.invoice_id, date_trunc('minute', ip.timestamp)`
    : '';
  return `
    SELECT paid_at, amount, method, source FROM (
      SELECT GREATEST(p.created_at, p.payment_date::timestamptz) AS paid_at,
             p.amount, p.payment_method AS method, 'balance' AS source
        FROM customer_payments p
       WHERE p.customer_id = $1
      ${invoicePart}
    ) paid
    ORDER BY paid_at DESC
    LIMIT 1`;
}

async function summary(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    const hasInvoices = await detectInvoicesTable();
    const base = await baseSelectAndJoin();
    const { rows } = await query(`${base} WHERE c.id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const c = rows[0];
    const { rows: paid } = await query(lastPaymentSql(hasInvoices), [req.params.id]);
    const last = paid[0];
    const out = {
      id: c.id,
      name: c.name,
      phone: c.phone,
      companyName: c.company_name,
      totalSpent: c.total_spent != null ? Number(c.total_spent) : 0,
      invoiceCount: c.invoice_count != null ? Number(c.invoice_count) : 0,
      lastPayment: last
        ? { date: last.paid_at, amount: Number(last.amount), method: last.method, source: last.source }
        : null,
    };
    if (includeBalance) out.creditBalance = Number(c.credit_balance || 0);
    return ok(res, out);
  } catch (err) {
    next(err);
  }
}

// Mutations run in one transaction with their audit entry: if the audit
// write fails, the change is rolled back rather than saved unrecorded.

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

    const { id, replayed } = await withTransaction(async (client) => {
      if (body.requestKey) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `customer_create:${body.requestKey}`,
        ]);
        const { rows: prior } = await client.query(
          `SELECT id FROM customers WHERE request_key = $1`,
          [body.requestKey],
        );
        if (prior.length) return { id: prior[0].id, replayed: true };
      }
      if (body.phone) await ensurePhoneUnique(client, body.phone);

      const snapshot = {};
      for (const [key, , normalize] of EDITABLE) {
        if (key === 'isActive') continue;
        snapshot[key] = normalize(body[key]);
      }

      const { rows } = await client.query(
        `INSERT INTO customers
           (name, phone, email, address, company_name, trn_number,
            credit_limit, notes, created_by, request_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          snapshot.name,
          snapshot.phone,
          snapshot.email,
          snapshot.address,
          snapshot.companyName,
          snapshot.trnNumber,
          snapshot.creditLimit,
          snapshot.notes,
          req.user.id,
          body.requestKey || null,
        ],
      );
      const newId = rows[0].id;

      await logActivity({
        client,
        entityType: 'customer',
        entityId: newId,
        action: 'customer.created',
        performedBy: req.user.id,
        newValue: { ...snapshot, isActive: true },
        notes: body.name,
      });
      return { id: newId, replayed: false };
    });

    if (!replayed) emitCustomerChanged(req.app.get('io'), id, 'created');

    const base = await baseSelectAndJoin();
    const { rows: full } = await query(`${base} WHERE c.id = $1`, [id]);
    const shaped = shapeCustomer(full[0], { includeBalance: true });
    return replayed ? ok(res, shaped) : created(res, shaped);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const includeBalance = canSeeBalance(req);
    const { id } = req.params;
    const body = updateSchema.parse(req.body || {});

    if (body.trnNumber !== undefined && !trnIsValid(body.trnNumber)) {
      throw new AppError(
        ERROR_CODES.VAL_INVALID_TRN,
        'TRN must be exactly 15 digits.',
        { status: 400, details: { field: 'trnNumber' } },
      );
    }

    const changed = await withTransaction(async (client) => {
      const { rows: existing } = await client.query(
        `SELECT * FROM customers WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!existing.length) {
        throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
          status: 404,
        });
      }
      const current = existing[0];

      if (
        body.expectedUpdatedAt &&
        new Date(body.expectedUpdatedAt).getTime() !==
          new Date(current.updated_at).getTime()
      ) {
        throw new AppError(
          ERROR_CODES.RESOURCE_CONFLICT,
          'This customer was changed by someone else. Reload to see the latest details, then reapply your edit.',
          { status: 409, details: { updatedAt: current.updated_at } },
        );
      }

      // Only fields the request sent and that actually differ.
      const before = {};
      const after = {};
      const columns = {};
      for (const [key, column, normalize] of EDITABLE) {
        if (body[key] === undefined) continue;
        const next = normalize(body[key]);
        const prev = storedValue(current, key, column, normalize);
        const same =
          key === 'creditLimit' ? Math.abs(prev - next) <= 0.001 : prev === next;
        if (same) continue;
        before[key] = prev;
        after[key] = next;
        columns[column] = next;
      }
      if (!Object.keys(after).length) return false;

      if (after.phone) await ensurePhoneUnique(client, after.phone, id);

      const cols = Object.keys(columns);
      const sets = cols.map((col, i) => `${col} = $${i + 1}`);
      await client.query(
        `UPDATE customers SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${cols.length + 1}`,
        [...cols.map((col) => columns[col]), id],
      );

      const pick = (obj, keys) =>
        Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
      const detailKeys = Object.keys(after).filter(
        (k) => k !== 'creditLimit' && k !== 'isActive',
      );
      if (detailKeys.length) {
        await logActivity({
          client,
          entityType: 'customer',
          entityId: id,
          action: 'customer.updated',
          performedBy: req.user.id,
          oldValue: pick(before, detailKeys),
          newValue: pick(after, detailKeys),
          notes: `Changed: ${detailKeys.join(', ')}`,
        });
      }
      if ('creditLimit' in after) {
        await logActivity({
          client,
          entityType: 'customer',
          entityId: id,
          action: 'customer.credit_limit_updated',
          performedBy: req.user.id,
          oldValue: { creditLimit: before.creditLimit },
          newValue: { creditLimit: after.creditLimit },
        });
      }
      if ('isActive' in after) {
        await logActivity({
          client,
          entityType: 'customer',
          entityId: id,
          action: 'customer.status_changed',
          performedBy: req.user.id,
          oldValue: { isActive: before.isActive },
          newValue: { isActive: after.isActive },
          notes: after.isActive ? 'Reactivated' : 'Deactivated',
        });
      }
      return true;
    });

    if (changed) emitCustomerChanged(req.app.get('io'), id, 'updated');

    const base = await baseSelectAndJoin();
    const { rows: full } = await query(`${base} WHERE c.id = $1`, [id]);
    return ok(res, shapeCustomer(full[0], { includeBalance }));
  } catch (err) {
    next(err);
  }
}

// Soft delete. Locks the customer row so it serialises with credit sales
// and collections: the zero-balance check and the deactivation see the same
// balance.
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const changed = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, credit_balance, is_active FROM customers WHERE id = $1 FOR UPDATE`,
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
      if (rows[0].is_active === false) return false;

      await client.query(
        `UPDATE customers SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [id],
      );

      await logActivity({
        client,
        entityType: 'customer',
        entityId: id,
        action: 'customer.deleted',
        performedBy: req.user.id,
        oldValue: { isActive: true },
        newValue: { isActive: false },
        notes: rows[0].name,
      });
      return true;
    });

    if (changed) emitCustomerChanged(req.app.get('io'), id, 'deactivated');

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
    // Also match the number in any stored spelling (050…, +971 50…, 00971…).
    const core = phoneSearchCore(q);
    if (core) {
      params.push(`%${core}%`);
      phoneCondition += ` OR ${digitsSql('c.phone')} LIKE $${params.length}`;
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
      `SELECT i.id, i.invoice_number, i.created_at, i.confirmed_at,
              i.status, i.payment_status, i.total, i.amount_paid, i.balance_due,
              i.pc_identifier,
              (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id)::int AS item_count
         FROM invoices i
        WHERE i.customer_id = $1
        ORDER BY i.created_at DESC`,
      [req.params.id],
    );
    const shaped = rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      createdAt: r.created_at,
      confirmedAt: r.confirmed_at,
      status: r.status,
      paymentStatus: r.payment_status,
      total: Number(r.total || 0),
      amountPaid: Number(r.amount_paid || 0),
      balanceDue: Number(r.balance_due || 0),
      pcIdentifier: r.pc_identifier,
      itemCount: r.item_count,
    }));
    return ok(res, shaped);
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

async function listReturns(req, res, next) {
  try {
    const customerId = req.params.id;
    // Pull every return request raised on this customer's account (any
    // status) so the profile can show pending + completed history.
    const { rows: requests } = await query(
      `SELECT r.id, r.request_number, r.return_type, r.status, r.reason,
              r.no_invoice_return, r.requested_at, r.reviewed_at,
              r.executed_at,
              (SELECT COALESCE(SUM(total_value),0)::numeric
                 FROM return_request_items ri
                WHERE ri.return_request_id = r.id) AS total_value,
              (SELECT COUNT(*)::int FROM return_request_items ri
                WHERE ri.return_request_id = r.id) AS item_count,
              i.invoice_number AS invoice_number,
              i.id AS invoice_id,
              ro.id AS return_order_id,
              ro.return_order_number AS return_order_number,
              ro.refund_total AS refund_total
         FROM return_requests r
         LEFT JOIN invoices i ON i.id = r.reference_id AND r.reference_type = 'invoice'
         LEFT JOIN return_orders ro ON ro.return_request_id = r.id
        WHERE r.customer_id = $1
        ORDER BY r.requested_at DESC`,
      [customerId],
    );

    // Return rate = value of goods actually taken back (executed return
    // orders) over gross confirmed sales — the same sales base as the
    // profile's cards.
    const { rows: totals } = await query(
      `SELECT
         (SELECT COALESCE(SUM(i.total),0)::numeric
            FROM invoices i
           WHERE i.customer_id = $1 AND i.status = 'confirmed') AS total_spent,
         (SELECT COALESCE(SUM(ro.total_value),0)::numeric
            FROM return_orders ro
           WHERE ro.customer_id = $1
             AND ro.return_type IN ('customer_refund', 'customer_replace')) AS total_returned,
         (SELECT COALESCE(SUM(ro.refund_total),0)::numeric
            FROM return_orders ro
           WHERE ro.customer_id = $1
             AND ro.return_type IN ('customer_refund', 'customer_replace')) AS total_refunded`,
      [customerId],
    );
    const totalSpent = Number(totals[0]?.total_spent || 0);
    const totalReturned = Number(totals[0]?.total_returned || 0);
    const totalRefunded = Number(totals[0]?.total_refunded || 0);
    const returnRate = totalSpent > 0 ? (totalReturned / totalSpent) * 100 : 0;

    return ok(
      res,
      {
        items: requests.map((r) => ({
          id: r.id,
          requestNumber: r.request_number,
          returnType: r.return_type,
          status: r.status,
          reason: r.reason,
          noInvoiceReturn: r.no_invoice_return,
          requestedAt: r.requested_at,
          reviewedAt: r.reviewed_at,
          executedAt: r.executed_at,
          totalValue: Number(r.total_value || 0),
          itemCount: r.item_count,
          invoiceId: r.invoice_id,
          invoiceNumber: r.invoice_number,
          returnOrderId: r.return_order_id,
          returnOrderNumber: r.return_order_number,
          refundTotal: r.refund_total != null ? Number(r.refund_total) : null,
        })),
        stats: {
          totalSpent,
          totalReturned,
          totalRefunded,
          returnRate: Math.round(returnRate * 10) / 10,
        },
      },
    );
  } catch (err) {
    next(err);
  }
}

async function listWarranties(req, res, next) {
  try {
    const customerId = req.params.id;
    // Surface every warranty linked to this customer, regardless of status.
    const { rows } = await query(
      `SELECT w.*,
              p.name AS product_name,
              p.image_path AS product_image_path,
              v.sku AS variant_sku,
              i.invoice_number AS invoice_number,
              c.name AS customer_name,
              c.phone AS customer_phone,
              s.name AS supplier_name,
              u.username AS created_by_username
         FROM warranties w
         LEFT JOIN products p ON p.id = w.product_id
         LEFT JOIN product_variants v ON v.id = w.variant_id
         LEFT JOIN invoices i ON i.id = w.invoice_id
         LEFT JOIN customers c ON c.id = w.customer_id
         LEFT JOIN suppliers s ON s.id = w.supplier_id
         LEFT JOIN users u ON u.id = w.created_by
        WHERE w.customer_id = $1
        ORDER BY w.end_date DESC NULLS LAST, w.created_at DESC`,
      [customerId],
    );
    const { shapeWarranty } = require('../services/warrantyService');
    return ok(
      res,
      rows.map((r) => shapeWarranty(r)),
    );
  } catch (err) {
    next(err);
  }
}

// One row per thing that happened, newest first, built from the source
// tables. Paged with a (at, key) cursor: pass the previous page's
// meta.nextCursor back as ?before=. The actor is the user the event belongs
// to (confirmer for a confirmation, canceller for a cancellation, ...);
// audit rows prefer the name recorded at the time.
const TIMELINE_ACTIONS = [
  'customer.created',
  'customer.updated',
  'customer.credit_limit_updated',
  'customer.status_changed',
  'customer.deleted',
];

function timelineSql(hasInvoices) {
  const parts = [
    `SELECT 'payment_collected' AS event, p.created_at AS at,
            'pay:' || p.id AS key, p.id::text AS ref,
            u.username AS employee, p.amount::numeric AS amount,
            p.payment_method AS status, NULL::text AS label,
            NULL::jsonb AS old_value, NULL::jsonb AS new_value
       FROM customer_payments p
       LEFT JOIN users u ON u.id = p.employee_id
      WHERE p.customer_id = $1`,
    // A voided collection keeps its original entry, plus the reversal.
    `SELECT 'payment_collected', v.created_at, 'pay:' || v.id, v.id::text,
            u.username, v.amount::numeric, 'voided', NULL::text,
            NULL::jsonb, NULL::jsonb
       FROM customer_payment_voids v
       LEFT JOIN users u ON u.id = v.employee_id
      WHERE v.customer_id = $1`,
    `SELECT 'payment_voided', v.voided_at, 'void:' || v.id, v.id::text,
            u.username, v.amount::numeric, v.payment_method, NULL::text,
            NULL::jsonb, NULL::jsonb
       FROM customer_payment_voids v
       LEFT JOIN users u ON u.id = v.voided_by
      WHERE v.customer_id = $1`,
    `SELECT 'profile_updated', al.timestamp, 'log:' || al.id, al.id::text,
            COALESCE(al.performed_by_name, u.username), NULL::numeric,
            al.action, al.notes, al.old_value, al.new_value
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.performed_by
      WHERE al.entity_type = 'customer'
        AND al.entity_id = $1
        AND al.action = ANY($4::text[])`,
  ];
  if (hasInvoices) {
    parts.push(
      // Drafts that never reached confirmation.
      `SELECT 'invoice_created', i.created_at, 'inv:' || i.id, i.id::text,
              u.username, i.total::numeric, i.status, i.invoice_number,
              NULL::jsonb, NULL::jsonb
         FROM invoices i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.customer_id = $1 AND i.confirmed_at IS NULL`,
      `SELECT 'invoice_confirmed', i.confirmed_at, 'invc:' || i.id, i.id::text,
              u.username, i.total::numeric, i.status, i.invoice_number,
              NULL::jsonb, NULL::jsonb
         FROM invoices i
         LEFT JOIN users u ON u.id = i.confirmed_by
        WHERE i.customer_id = $1 AND i.confirmed_at IS NOT NULL`,
      `SELECT 'invoice_cancelled', i.cancelled_at, 'invx:' || i.id, i.id::text,
              u.username, i.total::numeric, i.status, i.invoice_number,
              NULL::jsonb, NULL::jsonb
         FROM invoices i
         LEFT JOIN users u ON u.id = i.cancelled_by
        WHERE i.customer_id = $1 AND i.cancelled_at IS NOT NULL`,
      `SELECT 'return_processed', ro.created_at, 'ret:' || ro.id, ro.id::text,
              u.username, ro.refund_total::numeric, ro.return_type,
              ro.return_order_number, NULL::jsonb, NULL::jsonb
         FROM return_orders ro
         LEFT JOIN users u ON u.id = ro.employee_id
        WHERE ro.customer_id = $1
          AND ro.return_type IN ('customer_refund', 'customer_replace')`,
      `SELECT 'warranty_created', w.created_at, 'war:' || w.id, w.id::text,
              u.username, NULL::numeric, w.status, p.name,
              NULL::jsonb, NULL::jsonb
         FROM warranties w
         LEFT JOIN products p ON p.id = w.product_id
         LEFT JOIN users u ON u.id = w.created_by
        WHERE w.customer_id = $1`,
    );
  }
  return `
    SELECT t.*, t.at::text AS at_cursor FROM (
      ${parts.map((p) => `(${p})`).join('\n UNION ALL \n')}
    ) t(event, at, key, ref, employee, amount, status, label, old_value, new_value)
    WHERE t.at IS NOT NULL
      AND ($2::timestamptz IS NULL OR (t.at, t.key) < ($2::timestamptz, $3::text))
    ORDER BY t.at DESC, t.key DESC
    LIMIT $5`;
}

function decodeCursor(raw) {
  if (!raw) return [null, null];
  try {
    const [at, key] = JSON.parse(Buffer.from(String(raw), 'base64url').toString());
    // at is PostgreSQL's own text form of the timestamp, so microseconds
    // survive the round trip.
    if (!/^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)?$/.test(at)) throw new Error();
    if (typeof key !== 'string') throw new Error();
    return [at, key];
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid timeline cursor.', {
      status: 400,
    });
  }
}

async function listTimeline(req, res, next) {
  try {
    const customerId = req.params.id;
    const hasInvoices = await detectInvoicesTable();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const [beforeAt, beforeKey] = decodeCursor(req.query.before);

    // One extra row tells us whether another page exists.
    const { rows } = await query(timelineSql(hasInvoices), [
      customerId,
      beforeAt,
      beforeKey,
      TIMELINE_ACTIONS,
      limit + 1,
    ]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify([last.at_cursor, last.key]),
          ).toString('base64url')
        : null;

    const canSee = canSeeBalance(req);
    return ok(
      res,
      page.map((r) => ({
        event: r.event,
        at: r.at,
        referenceId: r.ref,
        employeeUsername: r.employee || 'system',
        amount: r.amount == null ? null : canSee ? Number(r.amount) : null,
        status: r.status,
        label: r.label,
        oldValue: r.old_value || null,
        newValue: r.new_value || null,
      })),
      { nextCursor },
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  summary,
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
