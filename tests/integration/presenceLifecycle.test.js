/**
 * Phase 5 of the audit fix plan: logout and live presence.
 *
 * Runs a real HTTP + Socket.IO server against its own database:
 * - presence goes only to users allowed to see it (F13)
 * - a session stays online while any of its tabs is connected (F05)
 * - logout, force logout and deactivation cut the session's sockets on the
 *   server, and the closed session can't reconnect (F01, F02)
 * - a heartbeat can't bring a closed session back to online (F01/F08)
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('presence and logout on real PostgreSQL', () => {
  let db, admin, server, baseUrl, request, ioClient, adminToken;
  const database = `presence_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const sockets = [];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function until(check, timeoutMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return true;
      await wait(25);
    }
    return false;
  }

  function connect(token) {
    return new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => reject(err));
      sockets.push(s);
    });
  }

  async function makeUser(roleName) {
    const bcrypt = require('bcrypt');
    const username = `u_${randomUUID().slice(0, 8)}`;
    const password = 'pw-12345678';
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [username, await bcrypt.hash(password, 4), role.id],
    );
    return { id: user.id, username, password };
  }

  async function login(user, pcIdentifier = `pc-${randomUUID().slice(0, 6)}`) {
    const res = await request(baseUrl).post('/auth/login').send({ username: user.username, password: user.password, pcIdentifier });
    expect(res.status).toBe(200);
    return res.body.data?.token ?? res.body.token;
  }

  const sessionRow = async (token) => {
    const { hashToken } = require('../../server/middleware/auth');
    return (await db.query(`SELECT id, status, logout_at FROM user_sessions WHERE token_hash = $1`, [hashToken(token)])).rows[0];
  };
  const updatesFor = (s, userId) => s.events.filter((e) => e.event === 'presence_update' && e.payload.userId === userId);

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

    const express = require('express');
    const http = require('node:http');
    request = require('supertest');
    ({ io: ioClient } = require('socket.io-client'));
    const app = express();
    app.use(express.json());
    app.use('/auth', require('../../server/routes/auth'));
    app.use('/users', require('../../server/routes/users'));
    app.use('/presence', require('../../server/routes/presence'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
    server = http.createServer(app);
    const io = require('../../server/socket').attachSocket(server);
    app.set('io', io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const auth = require('../../server/middleware/auth');
    const { rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = auth.signToken({ sub: adminId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'admin-pc',$2)`,
      [adminId, auth.hashToken(adminToken)]);
  }, 30000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('sends presence only to users allowed to see it', async () => {
    const observer = await connect(adminToken);
    const bystander = await makeUser('Cashier');
    const bystanderSocket = await connect(await login(bystander));
    await wait(100);

    const cashier = await makeUser('Cashier');
    await connect(await login(cashier));

    expect(await until(() => updatesFor(observer, cashier.id).some((e) => e.payload.entry?.status === 'online'))).toBe(true);
    expect(bystanderSocket.events.filter((e) => e.event === 'presence_update')).toHaveLength(0);

    const snapshot = await request(baseUrl).get('/presence').auth(adminToken, { type: 'bearer' });
    expect(snapshot.body.data.map((r) => r.userId)).toContain(cashier.id);
  });

  it('keeps a session online while another tab on it is still connected', async () => {
    const observer = await connect(adminToken);
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tabA = await connect(token);
    const tabB = await connect(token);

    tabA.disconnect();
    await wait(250);
    expect((await sessionRow(token)).status).toBe('online');
    expect(updatesFor(observer, cashier.id).some((e) => e.payload.entry === null)).toBe(false);

    tabB.disconnect();
    expect(await until(async () => (await sessionRow(token)).status === 'offline')).toBe(true);
    expect(await until(() => updatesFor(observer, cashier.id).some((e) => e.payload.entry === null))).toBe(true);
  });

  it('logout cuts the session socket on the server and the session cannot reconnect', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    const reasons = [];
    tab.on('disconnect', (reason) => reasons.push(reason));

    const res = await request(baseUrl).post('/auth/logout').auth(token, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(await until(() => reasons.includes('io server disconnect'))).toBe(true);
    await expect(connect(token)).rejects.toThrow('AUTH_SESSION_EXPIRED');
  });

  it('a heartbeat cannot bring a closed session back online', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    const reasons = [];
    tab.on('disconnect', (reason) => reasons.push(reason));
    const { id } = await sessionRow(token);
    // Closed behind the socket's back, e.g. by a sweep on another process.
    await db.query(`UPDATE user_sessions SET logout_at = NOW(), status = 'offline' WHERE id = $1`, [id]);

    tab.emit('heartbeat');
    expect(await until(() => reasons.includes('io server disconnect'))).toBe(true);
    const row = await sessionRow(token);
    expect(row.status).toBe('offline');
    expect(row.logout_at).not.toBeNull();
  });

  it('force logout tells the user and disconnects them even if the client ignores it', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    const reasons = [];
    tab.on('disconnect', (reason) => reasons.push(reason));

    const res = await request(baseUrl).post(`/users/${cashier.id}/force-logout`).auth(adminToken, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(await until(() => reasons.includes('io server disconnect'))).toBe(true);
    expect(tab.events.some((e) => e.event === 'force_logout')).toBe(true);
    await expect(connect(token)).rejects.toThrow('AUTH_SESSION_EXPIRED');
  });

  it('deactivating a user or changing their password ends their sessions and sockets', async () => {
    const a = await makeUser('Cashier');
    const tokenA = await login(a);
    const tabA = await connect(tokenA);
    const reasonsA = [];
    tabA.on('disconnect', (reason) => reasonsA.push(reason));
    expect((await request(baseUrl).put(`/users/${a.id}`).auth(adminToken, { type: 'bearer' }).send({ isActive: false })).status).toBe(200);
    expect(await until(() => reasonsA.includes('io server disconnect'))).toBe(true);
    expect((await sessionRow(tokenA)).logout_at).not.toBeNull();
    await expect(connect(tokenA)).rejects.toThrow('AUTH_SESSION_EXPIRED');

    const b = await makeUser('Cashier');
    const tokenB = await login(b);
    await connect(tokenB);
    expect((await request(baseUrl).put(`/users/${b.id}`).auth(adminToken, { type: 'bearer' }).send({ password: 'new-pass-12345' })).status).toBe(200);
    expect(await until(async () => (await sessionRow(tokenB)).logout_at !== null)).toBe(true);
    await expect(connect(tokenB)).rejects.toThrow('AUTH_SESSION_EXPIRED');
  });

  it('logging in again on the same PC cuts the replaced session\'s socket', async () => {
    const cashier = await makeUser('Cashier');
    const first = await login(cashier, 'till-7');
    const oldTab = await connect(first);
    const reasons = [];
    oldTab.on('disconnect', (reason) => reasons.push(reason));
    await login(cashier, 'till-7');
    expect(await until(() => reasons.includes('io server disconnect'))).toBe(true);
  });
  it('an unattended screen goes idle while staying connected (F08)', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    const { id } = await sessionRow(token);
    // Ten minutes without input, but the app is still open.
    await db.query(`UPDATE user_sessions SET last_activity_at = NOW() - INTERVAL '10 minutes',
                      last_seen_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
    tab.emit('heartbeat', { active: false });
    await wait(200);
    const { rows: [after] } = await db.query(
      `SELECT last_activity_at < NOW() - INTERVAL '9 minutes' AS stale, last_seen_at > NOW() - INTERVAL '10 seconds' AS seen
         FROM user_sessions WHERE id = $1`, [id]);
    expect(after).toEqual({ stale: true, seen: true });

    // Real input brings it back to fresh activity.
    await db.query(`UPDATE user_sessions SET status = 'idle', last_seen_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
    tab.emit('heartbeat', { active: true });
    expect(await until(async () => (await db.query(`SELECT status FROM user_sessions WHERE id = $1`, [id])).rows[0].status === 'online')).toBe(true);
  });

  it('heartbeats from many tabs are not each written (F16)', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    const { id } = await sessionRow(token);
    const read = async () => (await db.query(`SELECT last_activity_at, last_seen_at FROM user_sessions WHERE id = $1`, [id])).rows[0];
    const before = await read();
    await wait(50);
    // The connect just wrote the session, so a beat inside 20s writes nothing.
    tab.emit('heartbeat', { active: true });
    await wait(200);
    const after = await read();
    expect(new Date(after.last_activity_at).getTime()).toBe(new Date(before.last_activity_at).getTime());
    expect(tab.connected).toBe(true);
  });

  it('after a restart no session is shown online until it reconnects (F11)', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const tab = await connect(token);
    tab.disconnect();
    await db.query(`UPDATE user_sessions SET status = 'online' WHERE token_hash IS NOT NULL AND logout_at IS NULL`);
    const http = require('node:http');
    const other = http.createServer();
    require('../../server/socket').attachSocket(other);
    expect(await until(async () => Number((await db.query(
      `SELECT COUNT(*) AS n FROM user_sessions WHERE logout_at IS NULL AND status = 'online'`)).rows[0].n) === 0)).toBe(true);
    other.close();
  });

  it('the Users page counts a closed screen as offline, like the online list (F07)', async () => {
    const cashier = await makeUser('Cashier');
    const token = await login(cashier);
    const isOnline = async () => {
      const res = await request(baseUrl).get('/users').query({ search: cashier.username }).auth(adminToken, { type: 'bearer' });
      return res.body.data.find((u) => u.id === cashier.id)?.isOnline;
    };
    const s = await connect(token);
    expect(await isOnline()).toBe(true);
    s.disconnect();
    // Still signed in, but the screen is gone.
    expect(await until(async () => (await isOnline()) === false)).toBe(true);
    expect((await sessionRow(token)).logout_at).toBeNull();
  });
});
