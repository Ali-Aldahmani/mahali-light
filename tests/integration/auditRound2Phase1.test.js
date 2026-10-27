/**
 * Round 2, Phase 1 of the audit fixes, on real PostgreSQL: the approval
 * races (SI-01, INV-002), stock-count locking (INV-005), lock order and
 * deadlock retry (SI-08), invoice discount cap (SI-04), cancellation reason
 * (SI-07), quantity rule (INV-004), retry-safe product creates (INV-008)
 * and the login fixes (AUTH-05, AUTH-06, AUTH-07).
 *
 * The race tests hold a row or advisory lock on a second connection, start
 * the request under test, wait until PostgreSQL shows it blocked, then let
 * the "other" side commit. That reproduces the interleaving the audits
 * describe without timing guesses.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('audit round 2, phase 1 on real PostgreSQL', () => {
  let admin, db, invoices, app, request, token, userId, bcrypt;
  const database = `audit_r2p1_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const authed = (method, url) => request(app)[method](url).auth(token, { type: 'bearer' });

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
    await require('../../server/db/seed').run();
    await require('../../server/services/journalService').ensurePeriodsForDate(
      require('../../server/utils/dates').todayStoreDate(),
    );
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    invoices = require('../../server/services/invoiceService');
    bcrypt = require('bcrypt');
    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use('/auth', require('../../server/routes/auth'));
    app.use('/users', require('../../server/routes/users'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/products', require('../../server/routes/products'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  // --- helpers -------------------------------------------------------------

  async function variant({ stock = 20, soldBy = 'piece', price = 100 } = {}) {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, sold_by) VALUES ('Phase 1 item', $1) RETURNING id`, [soldBy]);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, $3, 40, $4) RETURNING *`, [p.id, randomUUID(), price, stock]);
    return v;
  }
  const stockOf = async (id) =>
    Number((await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [id])).rows[0].stock_qty);

  // A second connection holding a transaction open, standing in for the
  // other request in a race.
  async function holdTransaction() {
    const client = await db.getPool().connect();
    await client.query('BEGIN');
    return {
      query: (sql, params) => client.query(sql, params),
      async commit() { await client.query('COMMIT'); client.release(); },
    };
  }
  // Wait until `n` statements in this database are waiting on a lock.
  async function waitForBlocked(n = 1) {
    for (let i = 0; i < 100; i += 1) {
      const { rows: [r] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      if (r.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`expected ${n} blocked statement(s)`);
  }
  // Start a supertest request now (supertest is lazy until awaited/then'd).
  const start = (req) => new Promise((resolve) => { req.then(resolve, resolve); });

  // --- SI-01 / INV-002: rejection can't overwrite an approval -------------

  it('SI-01: rejecting an edit that an approval is applying is refused', async () => {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status) VALUES ($1, 'confirmed') RETURNING id`, [randomUUID()]);
    const { rows: [req] } = await db.query(
      `INSERT INTO invoice_edit_requests (invoice_id, requested_by, request_note, changes)
       VALUES ($1, $2, 'Fix a line', '{}') RETURNING id`, [inv.id, userId]);

    // The "approval" holds the request row and marks it approved.
    const approval = await holdTransaction();
    await approval.query(`SELECT id FROM invoice_edit_requests WHERE id = $1 FOR UPDATE`, [req.id]);
    await approval.query(`UPDATE invoice_edit_requests SET status = 'approved' WHERE id = $1`, [req.id]);

    const rejecting = invoices.rejectEditRequest({ requestId: req.id, managerId: userId, reason: 'Not needed' })
      .then(() => 'rejected', (err) => err);
    await waitForBlocked();
    await approval.commit();

    const outcome = await rejecting;
    expect(outcome.code).toBe('BIZ_EDIT_REQUEST_ALREADY_REVIEWED');
    const { rows: [after] } = await db.query(`SELECT status FROM invoice_edit_requests WHERE id = $1`, [req.id]);
    expect(after.status).toBe('approved');
    const { rows: history } = await db.query(
      `SELECT 1 FROM invoice_history WHERE invoice_id = $1 AND action = 'edit_rejected'`, [inv.id]);
    expect(history).toHaveLength(0);
  });

  it('INV-002: rejecting a stock adjustment that is being approved is refused', async () => {
    const v = await variant();
    const { rows: [adj] } = await db.query(
      `INSERT INTO stock_adjustment_requests
         (product_id, variant_id, adjustment_type, current_qty, requested_qty, difference, reason, request_note, requested_by)
       VALUES ($1, $2, 'remove', 20, 18, -2, 'damaged', 'Two dropped on delivery', $3) RETURNING id`,
      [v.product_id, v.id, userId]);

    const approval = await holdTransaction();
    await approval.query(`SELECT id FROM stock_adjustment_requests WHERE id = $1 FOR UPDATE`, [adj.id]);
    await approval.query(`UPDATE stock_adjustment_requests SET status = 'approved' WHERE id = $1`, [adj.id]);

    const rejecting = start(authed('put', `/stock/adjustments/${adj.id}/reject`).send({ rejectionReason: 'Recount first' }));
    await waitForBlocked();
    await approval.commit();

    expect((await rejecting).status).toBe(409);
    const { rows: [after] } = await db.query(`SELECT status FROM stock_adjustment_requests WHERE id = $1`, [adj.id]);
    expect(after.status).toBe('approved');
  });

  it('INV-002: rejecting a stock count that is being approved is refused', async () => {
    const { rows: [count] } = await db.query(
      `INSERT INTO stock_counts (count_type, status, initiated_by) VALUES ('full', 'pending_approval', $1) RETURNING id`, [userId]);

    const approval = await holdTransaction();
    await approval.query(`SELECT id FROM stock_counts WHERE id = $1 FOR UPDATE`, [count.id]);
    await approval.query(`UPDATE stock_counts SET status = 'approved' WHERE id = $1`, [count.id]);

    const rejecting = start(authed('put', `/stock/counts/${count.id}/reject`).send({ rejectionReason: 'Recount first' }));
    await waitForBlocked();
    await approval.commit();

    expect((await rejecting).status).toBe(409);
    const { rows: [after] } = await db.query(`SELECT status FROM stock_counts WHERE id = $1`, [count.id]);
    expect(after.status).toBe('approved');
    await db.query(`DELETE FROM stock_counts WHERE id = $1`, [count.id]);
  });

  // --- INV-005: stock counts and adjustments don't cross ------------------

  it('INV-005: two counts started together give one count', async () => {
    const v = await variant();
    // Hold the shared lock so both requests get past the quick check first.
    const gate = await holdTransaction();
    await gate.query(`SELECT pg_advisory_xact_lock(hashtextextended('stock_counts', 0))`);
    const body = { countType: 'partial', variantIds: [v.id] };
    const a = start(authed('post', '/stock/counts').send(body));
    const b = start(authed('post', '/stock/counts').send(body));
    await waitForBlocked(2);
    await gate.commit();

    const statuses = [(await a).status, (await b).status].sort();
    expect(statuses).toEqual([201, 409]);
    const { rows } = await db.query(
      `SELECT id FROM stock_counts WHERE status IN ('draft','in_progress','pending_approval')`);
    expect(rows).toHaveLength(1);
    await db.query(`DELETE FROM stock_counts WHERE id = $1`, [rows[0].id]);
  });

  it('INV-005: a direct adjustment that waits behind a starting count is refused', async () => {
    const v = await variant();
    // The "count" takes the shared lock and covers the variant.
    const counting = await holdTransaction();
    await counting.query(`SELECT pg_advisory_xact_lock(hashtextextended('stock_counts', 0))`);
    const { rows: [count] } = await counting.query(
      `INSERT INTO stock_counts (count_type, status, initiated_by) VALUES ('partial', 'in_progress', $1) RETURNING id`, [userId]);
    await counting.query(
      `INSERT INTO stock_count_items (stock_count_id, product_id, variant_id, system_qty, cost_price)
       VALUES ($1, $2, $3, 20, 40)`, [count.id, v.product_id, v.id]);

    const adjusting = start(authed('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId: v.id, adjustmentType: 'remove', quantity: 1, reason: 'damaged',
      note: 'Dropped while shelving', applyDirectly: true,
    }));
    await waitForBlocked();
    await counting.commit();

    const res = await adjusting;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BIZ_STOCK_COUNT_IN_PROGRESS');
    expect(await stockOf(v.id)).toBe(20);
    await db.query(`DELETE FROM stock_counts WHERE id = $1`, [count.id]);
  });

  // --- SI-08: lock order and deadlock retry --------------------------------

  it('SI-08: a sale locks its products in one fixed order', async () => {
    const [x, y] = [await variant({ price: 0 }), await variant({ price: 0 })];
    const [low, high] = x.id < y.id ? [x, y] : [y, x];
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, tax_rate) VALUES ($1, 0) RETURNING id`, [randomUUID()]);
    await db.withTransaction(async (client) => {
      // Listed high-then-low on purpose.
      await invoices.replaceItems(client, inv.id, [
        { variant_id: high.id, quantity: 1, unit_price: 0 },
        { variant_id: low.id, quantity: 1, unit_price: 0 },
      ]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });

    const holder = await holdTransaction();
    await holder.query(`SELECT id FROM product_variants WHERE id = $1 FOR UPDATE`, [low.id]);
    const confirming = invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId }).catch((e) => e);
    await waitForBlocked();
    // Waiting on the lower id, the sale must not already hold the higher one.
    const probe = await db.getPool().connect();
    try {
      await probe.query('BEGIN');
      await expect(probe.query(`SELECT id FROM product_variants WHERE id = $1 FOR UPDATE NOWAIT`, [high.id]))
        .resolves.toBeTruthy();
    } finally {
      await probe.query('ROLLBACK');
      probe.release();
    }
    await holder.commit();
    const confirmed = await confirming;
    expect(confirmed?.code).toBeUndefined();
    expect([await stockOf(low.id), await stockOf(high.id)]).toEqual([19, 19]);
  });

  it('SI-08: a deadlock victim is run again when the caller opts in', async () => {
    let calls = 0;
    const result = await db.withTransaction(async (client) => {
      calls += 1;
      await client.query('SELECT 1');
      if (calls === 1) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      return 'done';
    }, { retryOnDeadlock: true });
    expect(result).toBe('done');
    expect(calls).toBe(2);

    let plainCalls = 0;
    await expect(db.withTransaction(async () => {
      plainCalls += 1;
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    })).rejects.toMatchObject({ code: '40P01' });
    expect(plainCalls).toBe(1);
  });

  // --- SI-04 / SI-07: discount cap and cancellation reason ----------------

  it('SI-04: an invoice discount above the items total is refused', async () => {
    const v = await variant();
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, tax_rate, invoice_discount) VALUES ($1, 5, 1000) RETURNING id`, [randomUUID()]);
    const attempt = db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity: 1, unit_price: 100 }]);
      await invoices.assertInvoiceDiscountAllowed(client, inv.id);
    });
    await expect(attempt).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    await db.query(`UPDATE invoices SET invoice_discount = 100 WHERE id = $1`, [inv.id]);
    await expect(db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity: 1, unit_price: 100 }]);
      await invoices.assertInvoiceDiscountAllowed(client, inv.id);
    })).resolves.toBeUndefined();
  });

  it('SI-07: cancelling a confirmed invoice needs a reason', async () => {
    const v = await variant({ price: 0 });
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, tax_rate) VALUES ($1, 0) RETURNING id`, [randomUUID()]);
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity: 1, unit_price: 0 }]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });

    for (const reason of [undefined, '', '   ', 'no']) {
      await expect(invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId, reason }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await stockOf(v.id)).toBe(19);
    await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId, reason: 'Customer changed mind' });
    const { rows: [after] } = await db.query(`SELECT status, cancel_reason FROM invoices WHERE id = $1`, [inv.id]);
    expect(after).toMatchObject({ status: 'cancelled', cancel_reason: 'Customer changed mind' });
    expect(await stockOf(v.id)).toBe(20);
  });

  // --- INV-004: one quantity rule for every stock change ------------------

  it('INV-004: stock changes refuse extra decimals and part pieces', async () => {
    const piece = await variant();
    const metre = await variant({ soldBy: 'meter' });
    const adjust = (v, quantity) => authed('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId: v.id, adjustmentType: 'add', quantity, reason: 'found', note: 'Found in the back store', applyDirectly: true,
    });

    expect((await adjust(metre, 0.004)).status).toBe(400);
    expect((await adjust(piece, 1.5)).status).toBe(400);
    expect(await stockOf(piece.id)).toBe(20);
    expect((await adjust(metre, 1.5)).status).toBe(201);
    expect(await stockOf(metre.id)).toBe(21.5);
    expect((await adjust(piece, 2)).status).toBe(201);
    expect(await stockOf(piece.id)).toBe(22);
  });

  // --- INV-008: retry-safe product and variant creates --------------------

  it('INV-008: a retried product create makes one product with one opening stock', async () => {
    const key = randomUUID();
    const body = {
      name: `Retry lamp ${randomUUID()}`, hasVariants: false,
      simple: { sellingPrice: 25, costPrice: 10, openingStock: 7 },
    };
    const first = await authed('post', '/products').set('Idempotency-Key', key).send(body);
    const second = await authed('post', '/products').set('Idempotency-Key', key).send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status).toBe(201);
    const { rows: products } = await db.query(`SELECT id FROM products WHERE name = $1`, [body.name]);
    expect(products).toHaveLength(1);
    const { rows: movements } = await db.query(
      `SELECT m.quantity FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id
        WHERE v.product_id = $1 AND m.movement_type = 'opening_stock'`, [products[0].id]);
    expect(movements.map((m) => Number(m.quantity))).toEqual([7]);

    const variantKey = randomUUID();
    const vBody = { openingStock: 3, sellingPrice: 25 };
    const v1 = await authed('post', `/products/${products[0].id}/variants`).set('Idempotency-Key', variantKey).send(vBody);
    const v2 = await authed('post', `/products/${products[0].id}/variants`).set('Idempotency-Key', variantKey).send(vBody);
    expect(v1.status, JSON.stringify(v1.body)).toBe(201);
    expect(v2.status).toBe(201);
    const { rows: variants } = await db.query(`SELECT id FROM product_variants WHERE product_id = $1`, [products[0].id]);
    expect(variants).toHaveLength(2);
  });

  // --- AUTH-05 / AUTH-06 / AUTH-07: login -------------------------------

  async function staffUser(password = 'copper-lamp-harbor') {
    const username = `staff${randomUUID().slice(0, 8)}`;
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    await db.query(`INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3)`,
      [username, await bcrypt.hash(password, 4), role.id]);
    return { username, password };
  }
  const login = (body, ip = '10.0.0.5') =>
    request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ pcIdentifier: 'TILL-1', ...body });

  it('AUTH-07: two logins at once on one PC leave one open session', async () => {
    const u = await staffUser();
    const [a, b] = await Promise.all([login(u), login(u)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const { rows } = await db.query(
      `SELECT s.id FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE u.username = $1 AND s.logout_at IS NULL`, [u.username]);
    expect(rows).toHaveLength(1);
  });

  it('AUTH-05: parallel wrong guesses stop at the limit, and only for that PC', async () => {
    const u = await staffUser();
    const guesses = await Promise.all(Array.from({ length: 8 }, () => login({ ...u, password: 'wrong-guess-123' })));
    const counts = guesses.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    expect(counts[401]).toBe(5);
    expect(counts[423]).toBe(3);

    // The right password from the guessing PC waits out the lock...
    expect((await login(u)).status).toBe(423);
    // ...but the person's own till still signs in.
    expect((await login(u, '10.0.0.9')).status).toBe(200);

    // An Admin can clear the lock early, and that is logged.
    const { rows: [target] } = await db.query(`SELECT id FROM users WHERE username = $1`, [u.username]);
    const unlocked = await authed('post', `/users/${target.id}/unlock-login`);
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.data.lockoutsCleared).toBe(1);
    expect((await login(u)).status).toBe(200);
    const { rows: log } = await db.query(
      `SELECT 1 FROM activity_log WHERE entity_id = $1 AND action = 'user.login_unlocked'`, [target.id]);
    expect(log).toHaveLength(1);
  });

  it('AUTH-05: a successful login clears earlier failures', async () => {
    const u = await staffUser();
    for (let i = 0; i < 4; i += 1) expect((await login({ ...u, password: 'wrong-guess-123' }, '10.0.1.1')).status).toBe(401);
    expect((await login(u, '10.0.1.1')).status).toBe(200);
    for (let i = 0; i < 5; i += 1) expect((await login({ ...u, password: 'wrong-guess-123' }, '10.0.1.1')).status).toBe(401);
  });

  it('AUTH-06: new passwords follow the length and common-password rule', async () => {
    const { rows: [cashier] } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    const { rows: [adminRole] } = await db.query(`SELECT id FROM roles WHERE name = 'Admin'`);
    const create = (password, roleId = cashier.id) => authed('post', '/users').send({
      username: `new${randomUUID().slice(0, 8)}`, password, roleId,
    });
    expect((await create('short1')).status).toBe(400);
    expect((await create('Password123!')).status).toBe(400);
    expect((await create('1111111111')).status).toBe(400);
    expect((await create('ten-chars!')).status).toBe(201);
    expect((await create('eleven-char', adminRole.id)).status).toBe(400);
    expect((await create('twelve-chars', adminRole.id)).status).toBe(201);
  });
});
