/**
 * Pricing Restriction feature — live-PostgreSQL regression tests.
 *
 * Mirrors tests/integration/invoiceIntegrity.test.js and
 * tests/integration/routeAuthorization.test.js: creates and drops its own
 * database on an explicitly selected local test server. No production
 * credentials or database names are loaded from .env.
 *
 * Covers:
 *  - DB CHECK constraints reject mutually-exclusive / mismatched / out-of-
 *    bounds rows even via a raw SQL insert (not just app validation).
 *  - Upsert replaces the single per-product row and writes an audit entry
 *    (old value / new value / actor / action) via the existing activity_log.
 *  - Non-admin roles get a real 403 from the management/bulk endpoints.
 *  - A real POST /invoices (direct API call) cannot push a price/discount
 *    past a configured restriction — including when the caller holds
 *    invoice.override_price, proving the override permission alone isn't
 *    an escape hatch.
 *  - The invoice edit-request flow (the second choke point, which updates
 *    invoice_items directly rather than through replaceItems) is equally
 *    covered.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('pricing restrictions on real PostgreSQL', () => {
  let db, auth, app, request;
  let adminToken, adminId, managerToken, cashierToken, discounterToken, discounterId;
  const database = `pricing_restriction_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let admin;

  beforeAll(async () => {
    Object.assign(process.env, {
      PGHOST: '127.0.0.1', PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '', PGDATABASE: database,
    });
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Regression current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);
    await require('../../server/db/seed').run(); // real roles/permissions + seeded Admin

    // PDF rendering is outside these transaction tests.
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };

    auth = require('../../server/middleware/auth');

    async function makeUser(username, roleName) {
      const { rows: roleRows } = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ($1,'unused',$2,true) RETURNING id`,
        [username, roleRows[0].id],
      );
      const id = rows[0].id;
      const token = auth.signToken({ sub: id });
      await db.query(
        `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
        [id, auth.hashToken(token)],
      );
      return { id, token };
    }

    const { rows: seededAdmin } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin[0].id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );
    ({ token: managerToken } = await makeUser('manager1', 'Manager'));
    ({ id: discounterId, token: discounterToken } = await makeUser('discounter1', 'Cashier'));
    ({ token: cashierToken } = await makeUser('cashier1', 'Cashier'));
    const { rows: overridePerm } = await db.query(
      `SELECT id FROM permissions WHERE key = 'invoice.override_price'`,
    );
    await db.query(
      `INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, true)`,
      [discounterId, overridePerm[0].id],
    );

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/pricing-restrictions', require('../../server/routes/pricingRestrictions'));
    app.use((err, _req, res, _next) => res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message, details: err.details }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function variant({ price = 100, cost = 40, stock = 20 } = {}) {
    const product = (await db.query(`INSERT INTO products (name) VALUES ('Restriction test item') RETURNING id`)).rows[0];
    const v = (await db.query(`INSERT INTO product_variants (product_id,sku,selling_price,cost_price,stock_qty)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [product.id, randomUUID(), price, cost, stock])).rows[0];
    return { ...v, productId: product.id };
  }

  async function activityFor(entityId) {
    return (await db.query(
      `SELECT * FROM activity_log WHERE entity_type = 'pricing_restriction' AND entity_id = $1 ORDER BY timestamp ASC`,
      [entityId],
    )).rows;
  }

  // ---------------------------------------------------------------------
  // DB constraints
  // ---------------------------------------------------------------------

  it('DB rejects a row with more than one restriction value set', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, restriction_type, min_price, max_discount_percent)
       VALUES ($1,'MINIMUM_PRICE',50,10)`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects a restriction_type with no matching value set', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, restriction_type) VALUES ($1,'MINIMUM_PRICE')`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects an out-of-range discount percent', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, restriction_type, max_discount_percent)
       VALUES ($1,'MAX_DISCOUNT_PERCENT',150)`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects a second row for the same product (exactly one per product)', async () => {
    const v = await variant();
    await db.query(
      `INSERT INTO pricing_restrictions (product_id, restriction_type, min_price) VALUES ($1,'MINIMUM_PRICE',10)`,
      [v.productId],
    );
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, restriction_type, min_price) VALUES ($1,'MINIMUM_PRICE',20)`,
      [v.productId],
    )).rejects.toThrow();
  });

  // ---------------------------------------------------------------------
  // Admin CRUD + audit trail
  // ---------------------------------------------------------------------

  it('upsert replaces the one restriction per product and audits old/new value', async () => {
    const v = await variant();
    const create = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MINIMUM_PRICE', minPrice: 50 });
    expect(create.status).toBe(201);
    expect(create.body.data.restrictionType).toBe('MINIMUM_PRICE');
    expect(create.body.data.minPrice).toBe(50);

    const update = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MAX_DISCOUNT_PERCENT', maxDiscountPercent: 15 });
    expect(update.status).toBe(201);
    expect(update.body.data.restrictionType).toBe('MAX_DISCOUNT_PERCENT');

    // Still exactly one row for the product.
    const rows = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].restriction_type).toBe('MAX_DISCOUNT_PERCENT');

    const activity = await activityFor(update.body.data.id);
    expect(activity.map((a) => a.action)).toEqual(['pricing_restriction.created', 'pricing_restriction.updated']);
    expect(activity[0].performed_by).toBe(adminId);
    expect(activity[0].old_value).toBeNull();
    expect(activity[1].old_value.restrictionType).toBe('MINIMUM_PRICE');
    expect(activity[1].new_value.restrictionType).toBe('MAX_DISCOUNT_PERCENT');

    const remove = await request(app)
      .delete(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' });
    expect(remove.status).toBe(200);
    const afterRemove = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows;
    expect(afterRemove).toHaveLength(0);
    const removedActivity = await activityFor(update.body.data.id);
    expect(removedActivity.at(-1).action).toBe('pricing_restriction.removed');
  });

  it('bulk-apply sets the same MAX_DISCOUNT_PERCENT on multiple products in one call', async () => {
    const a = await variant();
    const b = await variant();
    const res = await request(app)
      .post('/pricing-restrictions/bulk')
      .auth(adminToken, { type: 'bearer' })
      .send({ productIds: [a.productId, b.productId], restrictionType: 'MAX_DISCOUNT_PERCENT', maxDiscountPercent: 20 });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    const rows = (await db.query(
      `SELECT product_id, max_discount_percent FROM pricing_restrictions WHERE product_id = ANY($1)`,
      [[a.productId, b.productId]],
    )).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => Number(r.max_discount_percent) === 20)).toBe(true);
  });

  it('non-admin roles get a real 403 from management and bulk endpoints', async () => {
    const v = await variant();
    for (const token of [managerToken, cashierToken]) {
      const put = await request(app)
        .put(`/pricing-restrictions/product/${v.productId}`)
        .auth(token, { type: 'bearer' })
        .send({ restrictionType: 'MINIMUM_PRICE', minPrice: 10 });
      expect(put.status).toBe(403);

      const bulk = await request(app)
        .post('/pricing-restrictions/bulk')
        .auth(token, { type: 'bearer' })
        .send({ productIds: [v.productId], restrictionType: 'MAX_DISCOUNT_PERCENT', maxDiscountPercent: 5 });
      expect(bulk.status).toBe(403);
    }
    // Reading a single product's restriction is intentionally broader
    // (product.view) so the POS/edit UI can reflect it.
    const get = await request(app)
      .get(`/pricing-restrictions/product/${v.productId}`)
      .auth(cashierToken, { type: 'bearer' });
    expect(get.status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // Enforcement on the real invoice-creation API — the actual "direct API
  // manipulation must never bypass the restriction" requirement.
  // ---------------------------------------------------------------------

  it('MINIMUM_PRICE rejects a below-floor price even from a caller holding invoice.override_price', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MINIMUM_PRICE', minPrice: 50 });

    // adminToken's role carries invoice.override_price — proving the
    // restriction isn't just "no permission", it's an unconditional floor.
    const res = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, unitPrice: 10 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');

    // A price at/above the floor is fine.
    const ok = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, unitPrice: 60 }] });
    expect(ok.status).toBe(201);
  });

  it('MAX_DISCOUNT_PERCENT rejects an excessive discount from staff with discount authority', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MAX_DISCOUNT_PERCENT', maxDiscountPercent: 10 });

    const tooMuch = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 20 }] }); // 20% off
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');

    const withinLimit = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 5 }] }); // 5% off
    expect(withinLimit.status).toBe(201);
  });

  it('MAX_DISCOUNT_AMOUNT rejects an excessive per-unit discount on draft item updates (PUT /invoices/:id/items)', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MAX_DISCOUNT_AMOUNT', maxDiscountAmount: 5 });

    const created = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1 }] });
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;

    const bumped = await request(app)
      .put(`/invoices/${invoiceId}/items`)
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 10 }] });
    expect(bumped.status).toBe(422);
    expect(bumped.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');
  });

  it('the edit-request flow (second choke point, bypasses replaceItems) is equally enforced', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MINIMUM_PRICE', minPrice: 50 });

    const created = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1 }] }); // full price 100
    expect(created.status).toBe(201);
    const invoiceId = created.body.data.id;

    const editReq = await request(app)
      .post(`/invoices/${invoiceId}/edit-request`)
      .auth(cashierToken, { type: 'bearer' })
      .send({
        requestNote: 'Regression: attempted below-floor price via edit-request',
        changes: { items: [{ variant_id: v.id, quantity: 1, unit_price: 5 }] },
      });
    expect(editReq.status).toBe(201);
    const reqId = editReq.body.data.id;

    const approve = await request(app)
      .put(`/invoices/${invoiceId}/edit-request/${reqId}/approve`)
      .auth(adminToken, { type: 'bearer' }); // Admin: holds both edit_approve and override_price
    expect(approve.status).toBe(422);
    expect(approve.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');

    // The invoice item must be unchanged — the rejected edit-request must
    // not have partially applied inside its own transaction.
    const item = (await db.query(`SELECT unit_price FROM invoice_items WHERE invoice_id = $1`, [invoiceId])).rows[0];
    expect(Number(item.unit_price)).toBe(100);
  });
});
