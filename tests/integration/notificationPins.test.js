/**
 * Swipe actions in the notification center: pin (left) keeps a notification
 * at the top, oldest pin first; delete (right, the dismiss endpoint) removes
 * it from this user's list for good, and unpins it.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('notification pins and delete on real PostgreSQL', () => {
  let db, admin, app, request, token, notificationId;
  const database = `notification_pins_${randomUUID().replaceAll('-', '')}`;
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

  const auth = () => ({ type: 'bearer' });
  const put = (path) => request(app).put(`/notifications${path}`).auth(token, auth()).send({});
  const del = (path) => request(app).delete(`/notifications${path}`).auth(token, auth());
  const list = async () => (await request(app).get('/notifications?limit=30').auth(token, auth())).body.data;
  const titles = async () => (await list()).map((n) => n.title);

  let ids = {};
  it('lists newest first with nothing pinned', async () => {
    const svc = require('../../server/services/notificationService');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    for (const [title, minutesAgo] of [['A', 40], ['B', 30], ['C', 20], ['D', 10]]) {
      await svc.notifyUser(u.id, { type: 'test.pin', category: 'system', severity: 'info', title, message: title });
      const { rows: [n] } = await db.query(`SELECT id FROM notifications WHERE title = $1`, [title]);
      await db.query(`UPDATE notifications SET created_at = NOW() - ($2 || ' minutes')::interval WHERE id = $1`, [n.id, String(minutesAgo)]);
      ids[title] = n.id;
    }
    expect((await titles()).filter((t) => 'ABCD'.includes(t))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('pinned notifications go on top, oldest pin first', async () => {
    expect((await put(`/${ids.B}/pin`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect((await put(`/${ids.D}/pin`)).status).toBe(200);
    const rows = (await list()).filter((n) => 'ABCD'.includes(n.title));
    expect(rows.map((n) => n.title)).toEqual(['B', 'D', 'C', 'A']);
    expect(rows[0].pinned_at).toBeTruthy();
    expect(rows[2].pinned_at).toBeNull();
  });

  it('pinning again keeps the original position', async () => {
    await put(`/${ids.B}/pin`);
    expect((await titles()).filter((t) => 'ABCD'.includes(t))).toEqual(['B', 'D', 'C', 'A']);
  });

  it('unpinning returns it to its normal place', async () => {
    expect((await del(`/${ids.B}/pin`)).status).toBe(200);
    expect((await titles()).filter((t) => 'ABCD'.includes(t))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('deleting removes it for good, including its pin', async () => {
    expect((await put(`/${ids.D}/dismiss`)).status).toBe(200);
    expect((await titles()).filter((t) => 'ABCD'.includes(t))).toEqual(['C', 'B', 'A']);
    const { rows } = await db.query(`SELECT 1 FROM notification_pins WHERE notification_id = $1`, [ids.D]);
    expect(rows).toHaveLength(0);
  });

  it('404s when pinning a notification the user cannot see', async () => {
    expect((await put(`/${randomUUID()}/pin`)).status).toBe(404);
  });
});
