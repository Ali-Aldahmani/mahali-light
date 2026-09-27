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
    app.use('/products', require('../../server/routes/products'));
    app.use('/app-settings', require('../../server/routes/appSettings'));
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

  it('DB accepts several rules on the same row', async () => {
    const v = await variant();
    await db.query(
      `INSERT INTO pricing_restrictions (product_id, min_price, max_discount_percent, max_discount_amount)
       VALUES ($1, 50, 10, 5)`,
      [v.productId],
    );
    const row = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows[0];
    expect(Number(row.min_price)).toBe(50);
    expect(Number(row.max_discount_percent)).toBe(10);
    expect(Number(row.max_discount_amount)).toBe(5);
  });

  it('DB rejects a row with every rule disabled', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id) VALUES ($1)`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects an out-of-range discount percent', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, max_discount_percent) VALUES ($1, 150)`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects a negative minimum price or discount amount', async () => {
    const v = await variant();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, min_price) VALUES ($1, -1)`,
      [v.productId],
    )).rejects.toThrow();
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, max_discount_amount) VALUES ($1, -1)`,
      [v.productId],
    )).rejects.toThrow();
  });

  it('DB rejects a second row for the same product (one row per product)', async () => {
    const v = await variant();
    await db.query(`INSERT INTO pricing_restrictions (product_id, min_price) VALUES ($1, 10)`, [v.productId]);
    await expect(db.query(
      `INSERT INTO pricing_restrictions (product_id, min_price) VALUES ($1, 20)`,
      [v.productId],
    )).rejects.toThrow();
  });

  // ---------------------------------------------------------------------
  // Admin CRUD + audit trail
  // ---------------------------------------------------------------------

  it('upsert stores several rules together, disables one, and audits old/new value', async () => {
    const v = await variant();
    const create = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 50, maxDiscountPercent: 15 });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ minPrice: 50, maxDiscountPercent: 15, maxDiscountAmount: null });

    // Disable the percent cap, enable the amount cap; the floor stays.
    const update = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 50, maxDiscountPercent: null, maxDiscountAmount: 5 });
    expect(update.status).toBe(201);
    expect(update.body.data).toMatchObject({ minPrice: 50, maxDiscountPercent: null, maxDiscountAmount: 5 });

    const rows = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].max_discount_percent).toBeNull();

    const activity = await activityFor(update.body.data.id);
    expect(activity.map((a) => a.action)).toEqual(['pricing_restriction.created', 'pricing_restriction.updated']);
    expect(activity[0].performed_by).toBe(adminId);
    expect(activity[0].old_value).toBeNull();
    expect(activity[1].old_value.maxDiscountPercent).toBe(15);
    expect(activity[1].new_value.maxDiscountPercent).toBeNull();
    expect(activity[1].new_value.maxDiscountAmount).toBe(5);

    const remove = await request(app)
      .delete(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' });
    expect(remove.status).toBe(200);
    const afterRemove = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows;
    expect(afterRemove).toHaveLength(0);
    const removedActivity = await activityFor(update.body.data.id);
    expect(removedActivity.at(-1).action).toBe('pricing_restriction.removed');
  });

  it('saving with every rule disabled removes the restriction and stops enforcing it', async () => {
    const v = await variant({ price: 100 });
    const created = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 90 });
    const cleared = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: null, maxDiscountPercent: null, maxDiscountAmount: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toBeNull();
    const rows = (await db.query(`SELECT * FROM pricing_restrictions WHERE product_id = $1`, [v.productId])).rows;
    expect(rows).toHaveLength(0);
    expect((await activityFor(created.body.data.id)).at(-1).action).toBe('pricing_restriction.removed');

    const sale = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, unitPrice: 10 }] });
    expect(sale.status).toBe(201);
  });

  it('rejects the legacy restrictionType field and out-of-range values', async () => {
    const v = await variant();
    const legacy = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ restrictionType: 'MINIMUM_PRICE', minPrice: 10 });
    expect(legacy.status).toBe(400);
    const pct = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ maxDiscountPercent: 101 });
    expect(pct.status).toBe(400);
    const neg = await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: -1 });
    expect(neg.status).toBe(400);
  });

  it('bulk-apply keeps other rules already enabled on a product', async () => {
    const v = await variant();
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 40 });
    const res = await request(app)
      .post('/pricing-restrictions/bulk')
      .auth(adminToken, { type: 'bearer' })
      .send({ productIds: [v.productId], restrictionType: 'MAX_DISCOUNT_PERCENT', maxDiscountPercent: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data[0]).toMatchObject({ minPrice: 40, maxDiscountPercent: 10, maxDiscountAmount: null });
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
        .send({ minPrice: 10 });
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
      .send({ minPrice: 50 });

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
      .send({ maxDiscountPercent: 10 });

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
      .send({ maxDiscountAmount: 5 });

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
      .send({ minPrice: 50 });

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

  it('minimum price + max discount % are enforced together on POST /invoices', async () => {
    const v = await variant({ price: 120 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 100, maxDiscountPercent: 5 });

    // 5% off 120 = 114: within both rules.
    const ok = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 6 }] });
    expect(ok.status).toBe(201);

    // 110 is above the floor but ~8.3% off: only the percent rule fails.
    const pctOnly = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 10 }] });
    expect(pctOnly.status).toBe(422);
    expect(pctOnly.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');
    expect(pctOnly.body.message).toContain('Maximum allowed discount is 5%.');
    expect(pctOnly.body.details.violations.map((x) => x.restrictionType)).toEqual(['MAX_DISCOUNT_PERCENT']);

    // 90 breaks both rules; both are reported.
    const both = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 30 }] });
    expect(both.status).toBe(422);
    expect(both.body.message).toContain('Minimum selling price is AED 100.00.');
    expect(both.body.details.violations.map((x) => x.restrictionType)).toEqual([
      'MINIMUM_PRICE',
      'MAX_DISCOUNT_PERCENT',
    ]);
  });

  it('all three rules enforced together; one failing rule rejects the sale', async () => {
    const v = await variant({ price: 120 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 100, maxDiscountPercent: 20, maxDiscountAmount: 15 });

    const ok = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 10 }] });
    expect(ok.status).toBe(201);

    // AED 20 off: floor (100) and 16.7% pass, amount cap (15) fails.
    const amountOnly = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 20 }] });
    expect(amountOnly.status).toBe(422);
    expect(amountOnly.body.message).toContain('Maximum allowed discount amount is AED 15.00.');
    expect(amountOnly.body.details.violations.map((x) => x.restrictionType)).toEqual(['MAX_DISCOUNT_AMOUNT']);
  });

  // ---------------------------------------------------------------------
  // Invoice-level discount + Cashier Mode trust boundary
  // ---------------------------------------------------------------------

  it('an invoice-level discount cannot push a restricted product below its minimum (POST /invoices)', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 90 });

    const bypass = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ invoiceDiscount: 20, items: [{ variantId: v.id, quantity: 1 }] });
    expect(bypass.status).toBe(422);
    expect(bypass.body.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');
    expect(bypass.body.message).toContain('Minimum selling price is AED 90.00.');

    const ok = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ invoiceDiscount: 5, items: [{ variantId: v.id, quantity: 1 }] });
    expect(ok.status).toBe(201);
  });

  it('the invoice discount is spread by line total across restricted and unrestricted lines', async () => {
    const restricted = await variant({ price: 100 });
    const free = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${restricted.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ minPrice: 90, maxDiscountPercent: 10 });

    // AED 20 over two equal lines → 10 each → restricted line nets 90 (10%): allowed.
    const ok = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ invoiceDiscount: 20, items: [{ variantId: restricted.id, quantity: 1 }, { variantId: free.id, quantity: 1 }] });
    expect(ok.status).toBe(201);

    // AED 30 → 15 each → restricted line nets 85: both rules fail.
    const tooMuch = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ invoiceDiscount: 30, items: [{ variantId: restricted.id, quantity: 1 }, { variantId: free.id, quantity: 1 }] });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.details.violations.map((x) => x.restrictionType)).toEqual([
      'MINIMUM_PRICE',
      'MAX_DISCOUNT_PERCENT',
    ]);
  });

  it('a held draft (PUT /invoices/:id/items) cannot add an invoice discount that breaks a restriction', async () => {
    const v = await variant({ price: 100 });
    await request(app)
      .put(`/pricing-restrictions/product/${v.productId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ maxDiscountAmount: 5 });
    const created = await request(app)
      .post('/invoices')
      .auth(discounterToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 2 }] });
    expect(created.status).toBe(201);

    const resumed = await request(app)
      .put(`/invoices/${created.body.data.id}/items`)
      .auth(discounterToken, { type: 'bearer' })
      .send({ invoiceDiscount: 20, items: [{ variantId: v.id, quantity: 2 }] }); // 10 off per unit
    expect(resumed.status).toBe(422);
    expect(resumed.body.message).toContain('Maximum allowed discount amount is AED 5.00.');
    const inv = (await db.query(`SELECT invoice_discount FROM invoices WHERE id = $1`, [created.body.data.id])).rows[0];
    expect(Number(inv.invoice_discount)).toBe(0);
  });

  it('a cashier without override cannot manipulate price or discounts through the API', async () => {
    const v = await variant({ price: 100 });
    const priced = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, unitPrice: 1 }] });
    expect(priced.status).toBe(201);
    const item = (await db.query(`SELECT unit_price FROM invoice_items WHERE invoice_id = $1`, [priced.body.data.id])).rows[0];
    expect(Number(item.unit_price)).toBe(100);
    expect(priced.body.data.total).toBeGreaterThanOrEqual(100);

    const lineDiscount = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ variantId: v.id, quantity: 1, discountAmount: 30 }] });
    expect(lineDiscount.status).toBe(403);

    const invoiceDiscount = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ invoiceDiscount: 30, items: [{ variantId: v.id, quantity: 1 }] });
    expect(invoiceDiscount.status).toBe(403);
  });

  it('actions hidden from cashiers in Cashier Mode are rejected by the API', async () => {
    const product = await request(app)
      .post('/products')
      .auth(cashierToken, { type: 'bearer' })
      .send({ name: 'Sneaky product', hasVariants: false, simple: { sellingPrice: 1 } });
    expect(product.status).toBe(403);

    const custom = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ isCustom: true, customDescription: 'Free stuff', quantity: 1, unitPrice: 0 }] });
    expect(custom.status).toBe(403);

    const draft = await request(app)
      .post('/invoices')
      .auth(cashierToken, { type: 'bearer' })
      .send({ items: [{ variantId: (await variant()).id, quantity: 1 }] });
    const cancel = await request(app)
      .post(`/invoices/${draft.body.data.id}/cancel`)
      .auth(cashierToken, { type: 'bearer' })
      .send({ reason: 'test' });
    expect(cancel.status).toBe(403);
  });

  it('public settings expose the negative-stock flag used by Cashier Mode', async () => {
    const res = await request(app).get('/app-settings/public');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.pos_allow_negative_stock).toBe('boolean');
  });
});
