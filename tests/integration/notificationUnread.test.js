/**
 * PUT /notifications/:id/unread undoes a read (the notification center's
 * "Mark unread"), and only for notifications the user can see.
 *
 * Regression: the visibility check bound the notification id as $1 while
 * the user-scope SQL also used $1/$2 for user/role, so every single
 * mark-read and dismiss failed with a 500 (the store swallowed it).
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('notification mark unread on real PostgreSQL', () => {
  let db, admin, app, request, token, notificationId;
  const database = `notification_unread_${randomUUID().replaceAll('-', '')}`;
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
    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [u.id, auth.hashToken(token)]);
    const svc = require('../../server/services/notificationService');
    const created = await svc.notifyUser(u.id, { type: 'test.unread', category: 'system', severity: 'info', title: 'Hello', message: 'World' });
    notificationId = (Array.isArray(created) ? created[0] : created)?.id
      ?? (await db.query(`SELECT id FROM notifications ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/notifications', require('../../server/routes/notifications'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const put = (path) => request(app).put(`/notifications${path}`).auth(token, { type: 'bearer' }).send({});

  it('marks read, then unread again', async () => {
    const before = (await request(app).get('/notifications/unread-count').auth(token, { type: 'bearer' })).body.data;
    const read = await put(`/${notificationId}/read`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const unread = await put(`/${notificationId}/unread`);
    expect(unread.status).toBe(200);
    expect(unread.body.data.unread_count).toBe(read.body.data.unread_count + 1);
    expect(JSON.stringify(before)).toContain(String(unread.body.data.unread_count));
  });

  it('is idempotent and 404s for unknown notifications', async () => {
    expect((await put(`/${notificationId}/unread`)).status).toBe(200);
    expect((await put(`/${randomUUID()}/unread`)).status).toBe(404);
  });

  it('dismisses a single notification (same visibility check)', async () => {
    expect((await put(`/${notificationId}/dismiss`)).status).toBe(200);
  });
});
