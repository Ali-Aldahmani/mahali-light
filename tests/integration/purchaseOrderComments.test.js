import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('Purchase Order Comments & Discussion integration on real PostgreSQL', () => {
  let db, auth, app, request, adminPool;
  let adminToken, adminId, cashierToken, cashierId, supplierId, poId, po2Id;
  const database = `po_comments_test_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  beforeAll(async () => {
    const pgUser = process.env.INVOICE_TEST_PG_USER || process.env.PGUSER || 'postgres';
    const pgPassword = process.env.INVOICE_TEST_PG_PASSWORD || process.env.PGPASSWORD || '';

    Object.assign(process.env, {
      PGHOST: '127.0.0.1',
      PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: pgUser,
      PGPASSWORD: pgPassword,
      PGDATABASE: database,
    });

    const { Pool } = require('pg');
    adminPool = new Pool({
      host: '127.0.0.1',
      port: process.env.INVOICE_TEST_PG_PORT,
      user: pgUser,
      password: pgPassword,
      database: 'postgres',
    });

    await adminPool.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;

    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();

    auth = require('../../server/middleware/auth');

    // Admin user (has * wildcard, including po.comments.view, po.comments.create, po.comments.react)
    const { rows: seededAdmin } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin[0].id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, 'test', $2)`,
      [adminId, auth.hashToken(adminToken)],
    );

    // Cashier user (does NOT have po.comments.* by default)
    const { rows: cashierRole } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    const { rows: [newCashier] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ('testcashier', 'hash', $1, true) RETURNING id`,
      [cashierRole[0].id],
    );
    cashierId = newCashier.id;
    cashierToken = auth.signToken({ sub: cashierId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, 'test', $2)`,
      [cashierId, auth.hashToken(cashierToken)],
    );

    // Create test supplier
    const { rows: [sup] } = await db.query(
      `INSERT INTO suppliers (name) VALUES ('Discussion Test Supplier') RETURNING id`,
    );
    supplierId = sup.id;

    // Create test PO 1
    const { rows: [po] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, employee_id, status)
       VALUES ('PO-DISC-001', $1, $2, 'draft') RETURNING id`,
      [supplierId, adminId],
    );
    poId = po.id;

    // Create test PO 2 (for cross-PO checks)
    const { rows: [po2] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, employee_id, status)
       VALUES ('PO-DISC-002', $1, $2, 'draft') RETURNING id`,
      [supplierId, adminId],
    );
    po2Id = po2.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use((err, _req, res, _next) =>
      res
        .status(err.status || (err.name === 'ZodError' ? 400 : 500))
        .json({ code: err.code, message: err.message, details: err.details }),
    );
  }, 35000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase && adminPool) {
      await adminPool.query(`DROP DATABASE ${database} WITH (FORCE)`);
    }
    if (adminPool) await adminPool.end();
  });

  let rootCommentId;
  let replyCommentId;

  it('unauthorized user cannot create comment (403)', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ body: 'Unauthorized comment attempt' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_NO_PERMISSION');
  });

  it('unauthorized user cannot view comments (403)', async () => {
    const res = await request(app)
      .get(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_NO_PERMISSION');
  });

  it('authorized user can create a root comment', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Please verify the delivery date with supplier.' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.body).toBe('Please verify the delivery date with supplier.');
    expect(res.body.data.purchaseOrderId).toBe(poId);
    expect(res.body.data.author.name).toBeDefined();
    expect(res.body.data.reactions).toEqual([]);
    rootCommentId = res.body.data.id;
  });

  it('rejects empty or whitespace-only comment body (400)', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: '   ' });

    expect(res.status).toBe(400);
  });

  it('rejects oversized comment body (400)', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'a'.repeat(5001) });

    expect(res.status).toBe(400);
  });

  it('authorized user can reply to a comment', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        body: 'Supplier confirmed delivery for tomorrow 10am.',
        parentId: rootCommentId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.parentId).toBe(rootCommentId);
    replyCommentId = res.body.data.id;
  });

  it('rejects reply with nonexistent parentId (404)', async () => {
    const fakeParentId = randomUUID();
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        body: 'Reply to ghost comment',
        parentId: fakeParentId,
      });

    expect(res.status).toBe(404);
  });

  it('rejects cross-PO parent references (400)', async () => {
    // Attempt to reply on po2 with a parent from po1
    const res = await request(app)
      .post(`/purchase-orders/${po2Id}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        body: 'Cross-PO injection attempt',
        parentId: rootCommentId,
      });

    expect(res.status).toBe(400);
  });

  it('retrieves discussion tree with nested replies and deterministic order', async () => {
    const res = await request(app)
      .get(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const root = res.body.data[0];
    expect(root.id).toBe(rootCommentId);
    expect(root.replies).toHaveLength(1);
    expect(root.replies[0].id).toBe(replyCommentId);
  });

  it('enforces idempotency on comment creation via Idempotency-Key header', async () => {
    const idempotencyKey = `idem-${randomUUID()}`;
    const payload = { body: 'Unique message with idempotent header.' };

    const first = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    const firstCommentId = first.body.data.id;

    // Retry with identical key and payload
    const second = await request(app)
      .post(`/purchase-orders/${poId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(firstCommentId);

    // Verify in database that only ONE comment was inserted
    const { rows } = await db.query(
      `SELECT count(*) FROM purchase_order_comments WHERE request_key = $1`,
      [idempotencyKey],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('allows reacting to a comment and prevents duplicate reactions for same emoji', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/comments/${rootCommentId}/reactions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ emoji: '👍', added: true });

    expect(res.status).toBe(200);
    expect(res.body.data.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ emoji: '👍', users: expect.arrayContaining([adminId]) }),
      ]),
    );

    // Submitting duplicate reaction does not duplicate count
    const resDup = await request(app)
      .post(`/purchase-orders/${poId}/comments/${rootCommentId}/reactions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ emoji: '👍', added: true });

    const thumbReaction = resDup.body.data.reactions.find((r) => r.emoji === '👍');
    expect(thumbReaction.users).toHaveLength(1);
  });

  it('allows removing own reaction', async () => {
    const res = await request(app)
      .delete(`/purchase-orders/${poId}/comments/${rootCommentId}/reactions/${encodeURIComponent('👍')}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const thumbReaction = res.body.data.reactions.find((r) => r.emoji === '👍');
    expect(thumbReaction).toBeUndefined();
  });

  it('database trigger strictly enforces immutability against UPDATE', async () => {
    await expect(
      db.query(
        `UPDATE purchase_order_comments SET body = 'Modified body' WHERE id = $1`,
        [rootCommentId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('database trigger strictly enforces immutability against DELETE', async () => {
    await expect(
      db.query(
        `DELETE FROM purchase_order_comments WHERE id = $1`,
        [rootCommentId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('no edit or update endpoints are exposed on the HTTP route (404)', async () => {
    const resPut = await request(app)
      .put(`/purchase-orders/${poId}/comments/${rootCommentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Hacked update attempt' });

    expect([404, 405]).toContain(resPut.status);

    const resPatch = await request(app)
      .patch(`/purchase-orders/${poId}/comments/${rootCommentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ body: 'Hacked patch attempt' });

    expect([404, 405]).toContain(resPatch.status);
  });

  it('no delete endpoints are exposed on the HTTP route (404)', async () => {
    const resDelete = await request(app)
      .delete(`/purchase-orders/${poId}/comments/${rootCommentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect([404, 405]).toContain(resDelete.status);
  });
});
