/**
 * Presence audit 2026-11-10: Online means a live connection.
 *
 * Real HTTP + Socket.IO servers against their own database:
 * - P0: signing in, or a request reporting input, never makes a session
 *   online without a live connection; input on an idle session is published
 * - P1: presence is shared across instances (SOCKET_CLUSTER=postgres), and a
 *   new instance does not mark another instance's screens offline
 * - P1: input carried by a heartbeat is never swallowed by the throttle
 * - P1: Last Seen survives sign-out
 * - a session nobody has seen for a while goes offline, and a beat from a
 *   socket that is in fact still connected brings it back
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('presence accuracy on real PostgreSQL', () => {
  let db, admin, request, ioClient, adminToken, adminId, auth;
  const database = `presence_acc_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const sockets = [];
  const servers = [];

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(check, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return true;
      await wait(25);
    }
    return false;
  }

  async function startServer({ cluster = false } = {}) {
    const express = require('express');
    const http = require('node:http');
    const app = express();
    app.use(express.json());
    app.use('/auth', require('../../server/routes/auth'));
    app.use('/users', require('../../server/routes/users'));
    app.use('/presence', require('../../server/routes/presence'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
    const server = http.createServer(app);
    const previous = process.env.SOCKET_CLUSTER;
    if (cluster) process.env.SOCKET_CLUSTER = 'postgres';
    const io = require('../../server/socket').attachSocket(server);
    if (cluster) process.env.SOCKET_CLUSTER = previous || '';
    app.set('io', io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const s = { server, io, url: `http://127.0.0.1:${server.address().port}` };
    servers.push(s);
    return s;
  }

  function connect(url, token) {
    return new Promise((resolve, reject) => {
      const s = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => reject(err));
      sockets.push(s);
    });
  }

  async function makeUser(roleName = 'Cashier') {
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
  async function login(url, user, pcIdentifier = `pc-${randomUUID().slice(0, 6)}`) {
    const res = await request(url).post('/auth/login').send({ username: user.username, password: user.password, pcIdentifier });
    expect(res.status).toBe(200);
    return res.body.data.token;
  }
  const row = async (token) => (await db.query(
    `SELECT id, status, logout_at, last_activity_at, last_seen_at FROM user_sessions WHERE token_hash = $1`,
    [auth.hashToken(token)])).rows[0];
  const setRow = (token, sql) => db.query(`UPDATE user_sessions SET ${sql} WHERE token_hash = $1`, [auth.hashToken(token)]);
  const listed = async (userId) =>
    (await require('../../server/services/presenceService').listPresence({ userId }))[0] || null;
  const updatesFor = (s, userId) => s.events.filter((e) => e.event === 'presence_update' && e.payload.userId === userId);

  let A;

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
    request = require('supertest');
    ({ io: ioClient } = require('socket.io-client'));
    auth = require('../../server/middleware/auth');
    A = await startServer();
    ({ rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    adminToken = auth.signToken({ sub: adminId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash, status) VALUES ($1,'admin-pc',$2,'offline')`,
      [adminId, auth.hashToken(adminToken)]);
  }, 30000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    for (const s of servers) {
      s.io.close();
      if (s.io.clusterPool) await s.io.clusterPool.end().catch(() => {});
    }
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('P0: signing in is not online until the screen connects', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    expect((await row(token)).status).toBe('offline');
    expect(await listed(u.id)).toBeNull();
    const s = await connect(A.url, token);
    expect(await until(async () => (await row(token)).status === 'online')).toBe(true);
    expect((await listed(u.id))?.status).toBe('online');
    s.disconnect();
  });

  it('P0: a request reporting input never makes a disconnected session online', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    s.disconnect();
    expect(await until(async () => (await row(token)).status === 'offline')).toBe(true);
    await setRow(token, `last_activity_at = NOW() - INTERVAL '1 minute', last_seen_at = NOW() - INTERVAL '1 minute'`);
    const before = await row(token);
    expect((await request(A.url).get('/auth/me').set('X-User-Active', '1').auth(token, { type: 'bearer' })).status).toBe(200);
    await wait(300);
    const after = await row(token);
    expect(after.status).toBe('offline');
    expect(await listed(u.id)).toBeNull();
    // Still counts as activity, so the session is not signed out as idle.
    expect(new Date(after.last_activity_at) > new Date(before.last_activity_at)).toBe(true);
  });

  it('P0: input over HTTP on an idle, connected session makes it online and tells the viewers', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const watcher = await connect(A.url, adminToken);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    await setRow(token, `status = 'idle', last_activity_at = NOW() - INTERVAL '6 minutes'`);
    const seen = updatesFor(watcher, u.id).length;
    await request(A.url).get('/auth/me').set('X-User-Active', '1').auth(token, { type: 'bearer' });
    expect(await until(async () => (await row(token)).status === 'online')).toBe(true);
    expect(await until(() => updatesFor(watcher, u.id).length > seen
      && updatesFor(watcher, u.id).at(-1).payload.entry?.status === 'online')).toBe(true);
    s.disconnect();
    watcher.disconnect();
  });

  it('P1: input on a heartbeat right after a background request is recorded', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    await setRow(token, `last_activity_at = NOW() - INTERVAL '4 minutes', last_seen_at = NOW() - INTERVAL '1 minute'`);
    await request(A.url).get('/auth/me').auth(token, { type: 'bearer' }); // refreshes last_seen_at, no input
    await wait(200);
    const before = (await row(token)).last_activity_at;
    s.emit('heartbeat', { active: true });
    expect(await until(async () => String((await row(token)).last_activity_at) !== String(before))).toBe(true);
    s.disconnect();
  });

  it('a session nobody has seen goes offline; a beat from a socket still connected brings it back', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const watcher = await connect(A.url, adminToken);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    await setRow(token, `last_seen_at = NOW() - INTERVAL '10 minutes'`);
    const { rows: gone } = await require('../../server/socket').sweepStaleConnections();
    expect(gone.map((r) => r.user_id)).toContain(u.id);
    expect((await row(token)).status).toBe('offline');
    expect((await row(token)).logout_at).toBeNull();
    // The screen is in fact still connected: its next beat, even without input, heals it.
    s.emit('heartbeat', { active: false });
    expect(await until(async () => (await row(token)).status === 'online')).toBe(true);
    expect(await until(() => updatesFor(watcher, u.id).at(-1)?.payload.entry?.status === 'online')).toBe(true);
    s.disconnect();
    watcher.disconnect();
  });

  it('P1: Last Seen survives sign-out', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    await request(A.url).post('/auth/logout').auth(token, { type: 'bearer' });
    s.disconnect();
    const res = await request(A.url).get('/users').query({ search: u.username }).auth(adminToken, { type: 'bearer' });
    const me = res.body.data.find((x) => x.id === u.id);
    expect(me.isOnline).toBe(false);
    expect(me.lastActiveAt).toBeTruthy();
  });

  it('P2: a reconnect is not input: an idle session reconnects as idle', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const s = await connect(A.url, token);
    await until(async () => (await row(token)).status === 'online');
    s.disconnect();
    await until(async () => (await row(token)).status === 'offline');
    await setRow(token, `last_activity_at = NOW() - INTERVAL '7 minutes'`);
    const before = (await row(token)).last_activity_at;
    const again = await connect(A.url, token);
    expect(await until(async () => (await row(token)).status === 'idle')).toBe(true);
    expect(String((await row(token)).last_activity_at)).toBe(String(before));
    // The screen says there was input: active at once.
    again.emit('heartbeat', { active: true });
    expect(await until(async () => (await row(token)).status === 'online')).toBe(true);
    again.disconnect();
  });

  it('P2: a session past its maximum length leaves the list at once; devices are counted', async () => {
    const u = await makeUser();
    const t1 = await login(A.url, u, 'pc-one');
    const t2 = await login(A.url, u, 'pc-two');
    const s1 = await connect(A.url, t1);
    const s2 = await connect(A.url, t2);
    await until(async () => (await row(t1)).status === 'online' && (await row(t2)).status === 'online');
    expect((await listed(u.id)).sessionCount).toBe(2);
    await setRow(t1, `absolute_expires_at = NOW() - INTERVAL '1 second'`);
    expect((await listed(u.id)).sessionCount).toBe(1);
    await setRow(t2, `absolute_expires_at = NOW() - INTERVAL '1 second'`);
    expect(await listed(u.id)).toBeNull();
    s1.disconnect();
    s2.disconnect();
  });

  it('P2: the screen is told the server time when it connects', async () => {
    const u = await makeUser();
    const token = await login(A.url, u);
    const s = await connect(A.url, token);
    expect(await until(() => s.events.some((e) => e.event === 'connected'))).toBe(true);
    const { serverTime } = s.events.find((e) => e.event === 'connected').payload;
    expect(Math.abs(Date.parse(serverTime) - Date.now())).toBeLessThan(5000);
    s.disconnect();
  });

  describe('several instances (SOCKET_CLUSTER=postgres)', () => {
    let B, C;
    beforeAll(async () => {
      B = await startServer({ cluster: true });
      C = await startServer({ cluster: true });
      await wait(500);
    });

    it('a viewer on one instance sees a user connected to another', async () => {
      const u = await makeUser();
      const token = await login(B.url, u);
      const watcher = await connect(C.url, adminToken);
      await wait(300);
      const s = await connect(B.url, token);
      expect(await until(() => updatesFor(watcher, u.id).at(-1)?.payload.entry?.status === 'online')).toBe(true);
      s.disconnect();
      expect(await until(() => updatesFor(watcher, u.id).at(-1)?.payload.entry === null)).toBe(true);
      watcher.disconnect();
    });

    it('a new instance does not mark screens on the others offline', async () => {
      const u = await makeUser();
      const token = await login(B.url, u);
      const s = await connect(B.url, token);
      await until(async () => (await row(token)).status === 'online');
      await startServer({ cluster: true });
      await wait(500);
      expect((await row(token)).status).toBe('online');
      expect(s.connected).toBe(true);
      s.disconnect();
    });

    it('signing a user out on one instance cuts their socket on another', async () => {
      const u = await makeUser();
      const token = await login(B.url, u);
      const s = await connect(B.url, token);
      await until(async () => (await row(token)).status === 'online');
      const res = await request(C.url).post(`/users/${u.id}/force-logout`).auth(adminToken, { type: 'bearer' }).send({});
      expect(res.status).toBe(200);
      expect(await until(() => !s.connected)).toBe(true);
      expect(s.events.some((e) => e.event === 'force_logout')).toBe(true);
    });

    it('a second tab on another instance keeps the session online when the first closes', async () => {
      const u = await makeUser();
      const token = await login(B.url, u);
      const t1 = await connect(B.url, token);
      const t2 = await connect(C.url, token);
      await until(async () => (await row(token)).status === 'online');
      t1.disconnect();
      await wait(600);
      expect((await row(token)).status).toBe('online');
      t2.disconnect();
      expect(await until(async () => (await row(token)).status === 'offline')).toBe(true);
    });
  });
});
