/**
 * Gaps closed after the 5 Nov review, through HTTP on real PostgreSQL: bank
 * collections name their account, supplier returns name their supplier, and
 * quarantined stock can be released or written off.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('review follow-up features on real PostgreSQL', () => {
  let db, admin, app, request, variantId, productId, manager;
  const database = `review_feat_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Feature item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, quarantine_qty)
       VALUES ($1, $2, 50, 20, 10, 4) RETURNING id`, [productId, randomUUID()]));

    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Manager'`);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ('feat_mgr', 'x', $1) RETURNING id`, [role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, 'pc', $2)`,
      [u.id, auth.hashToken(token)]);
    manager = { id: u.id, as: (method, url) => request(app)[method](url).auth(token, { type: 'bearer' }) };

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use(require('../../server/middleware/errors').errorHandler);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('a bank transfer collection must name its account', async () => {
    const { rows: [c] } = await db.query(`INSERT INTO customers (name, credit_balance) VALUES ('Owes', 100) RETURNING id`);
    const res = await manager.as('post', `/customers/${c.id}/payments`).set('Idempotency-Key', randomUUID())
      .send({ amount: 50, paymentMethod: 'bank_transfer' });
    expect(res.status).toBe(400);
  });

  it('a supplier return request must name the supplier', async () => {
    const res = await manager.as('post', '/return-requests').send({
      returnType: 'supplier_return', referenceType: 'manual', noInvoiceReturn: true,
      reason: 'defective', requestNote: 'Back to the supplier',
      items: [{ variantId, productId, quantity: 1, condition: 'damaged', unitPrice: 20 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(JSON.stringify(res.body)).toContain('supplier');
  });

  it('quarantined stock can be released or written off', async () => {
    const release = await manager.as('post', `/stock/quarantine/${variantId}`)
      .send({ action: 'release', quantity: 1, reason: 'Tested and working' });
    expect(release.status, JSON.stringify(release.body)).toBe(200);
    const writeOff = await manager.as('post', `/stock/quarantine/${variantId}`)
      .send({ action: 'write_off', quantity: 2, reason: 'Burnt out, no use' });
    expect(writeOff.status, JSON.stringify(writeOff.body)).toBe(200);
    const { rows: [v] } = await db.query(`SELECT stock_qty, quarantine_qty FROM product_variants WHERE id = $1`, [variantId]);
    expect(Number(v.quarantine_qty)).toBe(1);
    expect(Number(v.stock_qty)).toBe(11);
    const tooMany = await manager.as('post', `/stock/quarantine/${variantId}`)
      .send({ action: 'release', quantity: 5, reason: 'More than is there' });
    expect(tooMany.status).toBeGreaterThanOrEqual(400);
  });

  it('a replayed checkout with a changed cart updates its draft instead of keeping the old cart', async () => {
    const checkoutId = randomUUID();
    const first = await manager.as('post', '/invoices').send({ checkoutId, items: [{ variantId, quantity: 1 }] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await manager.as('post', '/invoices').send({ checkoutId, items: [{ variantId, quantity: 3 }] });
    expect(again.body.data.id).toBe(first.body.data.id);
    const { rows: [line] } = await db.query(`SELECT quantity FROM invoice_items WHERE invoice_id = $1`, [first.body.data.id]);
    expect(Number(line.quantity)).toBe(3);
  });

  it('a session nobody closed is closed later, without invented overtime', async () => {
    const { rows: [emp] } = await db.query(`INSERT INTO employees (name, standard_hours) VALUES ('Forgot to sign out', 8) RETURNING id`);
    const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2::date, $2::date + TIME '09:00', 'present')`,
      [emp.id, day]);
    await require('../../server/services/attendanceService').closeMissedSessions();
    const { rows: [row] } = await db.query(`SELECT check_out, working_hours, overtime_hours FROM attendance WHERE employee_id = $1`, [emp.id]);
    expect(row.check_out).not.toBeNull();
    expect(Number(row.overtime_hours)).toBe(0);
    expect(Number(row.working_hours)).toBeLessThanOrEqual(8);
  });
});
