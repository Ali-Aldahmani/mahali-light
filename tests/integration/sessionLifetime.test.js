/**
 * Round 2, Phase 3 of the audit fixes (authentication audit AUTH-01, -02,
 * -03, -09), on real PostgreSQL with a real HTTP + Socket.IO server:
 * - an unattended screen is signed out after the idle limit even while its
 *   connection stays alive; a closed screen after 30 minutes; any session
 *   after its maximum length
 * - only requests that report input count as activity
 * - refresh rotates the token, keeps the old one for a minute, never
 *   outlives the maximum length, and stops working past it
 * - "sign out all my devices" closes every session
 * - plain HTTP and plain-HTTP sockets from other machines are refused when
 *   HTTPS is required
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('session lifetime and HTTPS on real PostgreSQL', () => {
  let db, admin, server, baseUrl, io, ioClient, request, auth, sessionPolicy;
  const database = `session_life_${randomUUID().replaceAll('-', '')}`;
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

  async function signIn(roleName = 'Cashier') {
    const bcrypt = require('bcrypt');
    const username = `u_${randomUUID().slice(0, 8)}`;
    const password = 'copper-lamp-harbor';
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [user] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id`,
      [username, await bcrypt.hash(password, 4), role.id]);
    const res = await request(baseUrl).post('/auth/login')
      .send({ username, password, pcIdentifier: `pc-${randomUUID().slice(0, 6)}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { userId: user.id, token: res.body.data.token, body: res.body.data };
  }
  const session = async (token) =>
    (await db.query(`SELECT * FROM user_sessions WHERE token_hash = $1`, [auth.hashToken(token)])).rows[0];
  const me = (token, headers = {}) => request(baseUrl).get('/auth/me').set(headers).auth(token, { type: 'bearer' });

  function connect(token, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const s = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders });
      s.events = [];
      s.onAny((event, payload) => s.events.push({ event, payload }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      sockets.push(s);
    });
  }

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
    auth = require('../../server/middleware/auth');
    sessionPolicy = require('../../server/services/sessionPolicy');

    const express = require('express');
    const http = require('node:http');
    request = require('supertest');
    ({ io: ioClient } = require('socket.io-client'));
    const app = express();
    app.use(express.json());
    app.use('/auth', require('../../server/routes/auth'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
    server = http.createServer(app);
    io = require('../../server/socket').attachSocket(server);
    app.set('io', io);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 30000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  // --- AUTH-03: idle and closed screens ----------------------------------

  it('AUTH-03: a connected but unattended screen is signed out after the idle limit', async () => {
    const idle = await signIn();
    const busy = await signIn();
    const idleSocket = await connect(idle.token);
    await connect(busy.token);
    // Both connections are alive; only one had input in the last 15 minutes.
    await db.query(`UPDATE user_sessions SET last_seen_at = NOW(), last_activity_at = NOW() - INTERVAL '16 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(idle.token)]);
    await db.query(`UPDATE user_sessions SET last_seen_at = NOW(), last_activity_at = NOW() - INTERVAL '10 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(busy.token)]);

    await sessionPolicy.sweepSessions(io);

    expect(await session(idle.token)).toMatchObject({ logout_type: 'idle', status: 'offline' });
    expect((await session(busy.token)).logout_at).toBeNull();
    expect(await until(() => idleSocket.events.some((e) => e.event === 'force_logout'))).toBe(true);
    expect((await me(idle.token)).status).toBe(401);
    expect((await me(busy.token)).status).toBe(200);
  });

  it('AUTH-03: a closed screen is signed out after 30 minutes, and 0 turns idle sign-out off', async () => {
    const gone = await signIn();
    const quiet = await signIn();
    await db.query(`UPDATE user_sessions SET last_seen_at = NOW() - INTERVAL '31 minutes', last_activity_at = NOW() - INTERVAL '31 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(gone.token)]);
    await db.query(`UPDATE user_sessions SET last_seen_at = NOW(), last_activity_at = NOW() - INTERVAL '20 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(quiet.token)]);

    await sessionPolicy.sweepSessions(io, { idleMinutes: 0 });

    expect(await session(gone.token)).toMatchObject({ logout_type: 'timeout' });
    expect((await session(quiet.token)).logout_at).toBeNull();
  });

  it('AUTH-03: only requests that report input count as activity', async () => {
    const s = await signIn();
    await db.query(`UPDATE user_sessions SET last_seen_at = NOW() - INTERVAL '5 minutes', last_activity_at = NOW() - INTERVAL '5 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(s.token)]);
    expect((await me(s.token)).status).toBe(200);
    await until(async () => (await session(s.token)).last_seen_at > new Date(Date.now() - 60000));
    const afterQuiet = await session(s.token);
    expect(afterQuiet.last_activity_at < new Date(Date.now() - 4 * 60000)).toBe(true);

    expect((await me(s.token, { 'X-User-Active': '1' })).status).toBe(200);
    expect(await until(async () => (await session(s.token)).last_activity_at > new Date(Date.now() - 60000))).toBe(true);
  });

  // --- AUTH-02: refresh and maximum length -------------------------------

  it('AUTH-02: refresh rotates the token, keeps the old one for a minute, and keeps the maximum length', async () => {
    const s = await signIn();
    const before = await session(s.token);
    expect(new Date(before.absolute_expires_at).getTime())
      .toBeGreaterThan(Date.now() + 11.9 * 3600 * 1000);
    expect(s.body.idleSignOutMinutes).toBe(15);

    const refreshed = await request(baseUrl).post('/auth/refresh').auth(s.token, { type: 'bearer' });
    expect(refreshed.status).toBe(200);
    const newToken = refreshed.body.data.token;
    expect(newToken).not.toBe(s.token);
    const after = await session(newToken);
    expect(after.id).toBe(before.id);
    expect(after.absolute_expires_at).toEqual(before.absolute_expires_at);
    // A refresh is not someone using the till.
    expect(after.last_activity_at).toEqual(before.last_activity_at);

    // The old token still works within the minute...
    expect((await me(s.token)).status).toBe(200);
    // ...and not after it.
    await db.query(`UPDATE user_sessions SET token_rotated_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [before.id]);
    expect((await me(s.token)).status).toBe(401);
    expect((await me(newToken)).status).toBe(200);
  });

  it('AUTH-02: a token never outlives the session, and nothing works past the maximum length', async () => {
    const s = await signIn();
    await db.query(`UPDATE user_sessions SET absolute_expires_at = NOW() + INTERVAL '5 minutes'
                     WHERE token_hash = $1`, [auth.hashToken(s.token)]);
    const refreshed = await request(baseUrl).post('/auth/refresh').auth(s.token, { type: 'bearer' });
    const { exp } = JSON.parse(Buffer.from(refreshed.body.data.token.split('.')[1], 'base64url').toString());
    expect(exp * 1000).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 2000);

    const token = refreshed.body.data.token;
    await db.query(`UPDATE user_sessions SET absolute_expires_at = NOW() - INTERVAL '1 second'
                     WHERE token_hash = $1`, [auth.hashToken(token)]);
    expect((await me(token)).status).toBe(401);
    expect((await request(baseUrl).post('/auth/refresh').auth(token, { type: 'bearer' })).status).toBe(401);
    await expect(connect(token)).rejects.toThrow(/AUTH_SESSION_EXPIRED/);
    await sessionPolicy.sweepSessions(io);
    expect(await session(token)).toMatchObject({ logout_type: 'expired' });
  });

  it('AUTH-02: a live connection outlasts the token it was opened with', async () => {
    const s = await signIn();
    // A session whose first token runs out in two seconds.
    const shortToken = auth.signToken({ sub: s.userId }, { expiresIn: 2 });
    await db.query(`UPDATE user_sessions SET token_hash = $1 WHERE token_hash = $2`,
      [auth.hashToken(shortToken), auth.hashToken(s.token)]);
    const socket = await connect(shortToken);
    expect((await request(baseUrl).post('/auth/refresh').auth(shortToken, { type: 'bearer' })).status).toBe(200);
    await wait(2500);
    socket.emit('heartbeat', { active: true });
    await wait(300);
    expect(socket.connected).toBe(true);
  });

  // --- AUTH-09: sign out all devices ---------------------------------------

  it('AUTH-09: "sign out all my devices" closes every session of the user', async () => {
    const first = await signIn();
    const { rows: [user] } = await db.query(`SELECT username FROM users WHERE id = $1`, [first.userId]);
    const second = await request(baseUrl).post('/auth/login')
      .send({ username: user.username, password: 'copper-lamp-harbor', pcIdentifier: 'phone-1' });
    const phone = await connect(second.body.data.token);

    const res = await request(baseUrl).post('/auth/logout-all').auth(first.token, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.data.sessionsClosed).toBe(2);
    expect((await me(first.token)).status).toBe(401);
    expect((await me(second.body.data.token)).status).toBe(401);
    expect(await until(() => !phone.connected)).toBe(true);
  });

  // --- AUTH-01: plain HTTP refused -----------------------------------------

  it('AUTH-01: plain HTTP from another machine is refused; HTTPS through the proxy and local calls pass', async () => {
    const express = require('express');
    const { requireSecureTransport } = require('../../server/middleware/secureTransport');
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(requireSecureTransport({ required: true }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));

    // Forwarded by the proxy for a till that came in over plain HTTP.
    const plain = await request(app).get('/ping').set('X-Forwarded-For', '192.168.1.40').set('X-Forwarded-Proto', 'http');
    expect(plain.status).toBe(403);
    expect(plain.body.message).toMatch(/https:\/\//);
    // Forwarded by the proxy after HTTPS.
    expect((await request(app).get('/ping').set('X-Forwarded-For', '192.168.1.40').set('X-Forwarded-Proto', 'https')).status).toBe(200);
    // A local script or the health check.
    expect((await request(app).get('/ping')).status).toBe(200);
  });

  it('AUTH-01: a plain-HTTP socket from another machine is refused when HTTPS is required', async () => {
    const http = require('node:http');
    const { attachSocket } = require('../../server/socket');
    const strictServer = http.createServer();
    const trust = (addr) => addr === '127.0.0.1' || addr === '::ffff:127.0.0.1' || addr === '::1';
    const strictIo = attachSocket(strictServer, new Set(), { requireSecure: true, trustProxy: () => trust });
    await new Promise((resolve) => strictServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${strictServer.address().port}`;
    const s = await signIn();
    const open = (headers) => new Promise((resolve) => {
      const c = ioClient(url, { auth: { token: s.token }, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: headers });
      c.on('connect', () => { c.disconnect(); resolve('connected'); });
      c.on('connect_error', (err) => resolve(err.message));
    });
    try {
      expect(await open({ 'x-forwarded-for': '192.168.1.40', 'x-forwarded-proto': 'http' })).toBe('HTTPS_REQUIRED');
      expect(await open({ 'x-forwarded-for': '192.168.1.40', 'x-forwarded-proto': 'https' })).toBe('connected');
    } finally {
      strictIo.close();
      await new Promise((resolve) => strictServer.close(resolve));
    }
  });
});
