/**
 * Telegram stock alerts, end to end against a fake Telegram Bot API.
 *
 * Stock changes go through stockService.applyStockMovement inside an outer
 * transaction - exactly how checkout sells - which never emitted the in-app
 * low-stock notification. The sender job reads reorder_alerts instead, so it
 * must catch these. Also covers: setup flow (token check, find chat, test
 * message), the token never leaving the server, no flood of old alerts when
 * switching on, grouping, no re-sends, and retry behaviour (internet down vs
 * Telegram refusing).
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);
const TOKEN = '123456789:AAHfakeTokenForTestsOnly_abcdefghijk';

describe('telegram message format', () => {
  const { buildStockAlertMessage, maskToken } = require('../../server/services/telegramService');
  const fan = { product_name: 'Ceiling <Fan>', sku: 'FAN-1', unit_label: 'pcs', stock_qty: '4.00', reorder_point: '5.00', recommended_order_qty: '6.00' };

  it('formats a single alert with stock, threshold and suggested order', () => {
    expect(buildStockAlertMessage([fan], 'Mahali & Sons')).toBe(
      '⚠️ <b>Low stock</b> · Mahali &amp; Sons\n\n<b>Ceiling &lt;Fan&gt;</b>\nSKU: <code>FAN-1</code>\nIn stock: <b>4 pcs</b> (alert at 5)\nSuggested order: 6 pcs',
    );
  });

  it('groups several alerts and flags out-of-stock items', () => {
    const msg = buildStockAlertMessage([fan, { ...fan, product_name: 'Cable', unit_label: 'm', stock_qty: '0' }], null);
    expect(msg).toBe(
      '⚠️ <b>2 items need restocking</b>\n\n🟠 <b>Ceiling &lt;Fan&gt;</b>: 4 pcs left (alert at 5)\n🔴 <b>Cable</b>: 0 m left (alert at 5)',
    );
  });

  it('masks the token', () => {
    expect(maskToken(TOKEN)).toBe('123456789:••••hijk');
  });
});

describe.skipIf(!enabled)('telegram stock alerts on real PostgreSQL', () => {
  let db, admin, app, request, adminToken, adminId, telegram, stockService;
  const database = `telegram_alerts_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let fake;
  const sent = []; // sendMessage bodies the fake Telegram received
  let sendMode = 'ok'; // ok | down | reject
  const variants = {};

  function startFakeTelegram() {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          const [, bot, method] = req.url.match(/^\/bot([^/]+)\/(\w+)$/) || [];
          const body = raw ? JSON.parse(raw) : {};
          const reply = (status, json) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(json));
          };
          if (bot !== TOKEN) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
          if (method === 'getMe') return reply(200, { ok: true, result: { id: 123456789, is_bot: true, username: 'mahali_alerts_bot' } });
          if (method === 'getUpdates') {
            return reply(200, { ok: true, result: [{ update_id: 1, message: { message_id: 1, text: '/start', chat: { id: 777001, type: 'private', first_name: 'Ali' } } }] });
          }
          if (method === 'sendMessage') {
            if (sendMode === 'down') return res.destroy();
            if (sendMode === 'reject') return reply(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
            sent.push(body);
            return reply(200, { ok: true, result: { message_id: sent.length } });
          }
          return reply(404, { ok: false, description: 'Not Found' });
        });
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  // Sell inside an outer transaction, like invoiceService does at checkout.
  async function sell(key, qty) {
    await db.withTransaction((client) =>
      stockService.applyStockMovement({
        client, variantId: variants[key], type: 'sale', quantity: qty,
        referenceType: 'invoice', referenceId: randomUUID(), employeeId: adminId, io: null,
      }),
    );
  }
  async function restock(key, qty) {
    await stockService.applyStockMovement({ variantId: variants[key], type: 'purchase', quantity: qty, employeeId: adminId });
  }
  const api = (method, path, body) =>
    request(app)[method](`/telegram${path}`).auth(adminToken, { type: 'bearer' }).send(body || {});

  beforeAll(async () => {
    fake = await startFakeTelegram();
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${fake.address().port}`;
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
    telegram = require('../../server/services/telegramService');
    stockService = require('../../server/services/stockService');

    for (const [key, name, unit] of [['fan', 'Ceiling Fan', 'pcs'], ['cable', 'Copper Cable 2.5mm', 'm'], ['bulb', 'LED Bulb', 'pcs']]) {
      const { rows: [p] } = await db.query(
        `INSERT INTO products (name, sold_by, unit_label, is_active) VALUES ($1, 'piece', $2, true) RETURNING id`, [name, unit]);
      const { rows: [v] } = await db.query(
        `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, reorder_threshold, is_active)
         VALUES ($1, $2, $2, 50, 20, 10, 5, true) RETURNING id`, [p.id, `SKU-${key.toUpperCase()}`]);
      variants[key] = v.id;
    }

    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = u.id;
    adminToken = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [u.id, auth.hashToken(adminToken)]);
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/telegram', require('../../server/routes/telegram'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    if (fake) fake.close();
    delete process.env.TELEGRAM_API_BASE;
  });

  it('rejects a malformed or wrong token and cannot be switched on half set up', async () => {
    expect((await api('put', '', { botToken: 'not-a-token' })).status).toBe(400);
    const wrong = await api('put', '', { botToken: '123456789:AAHwrongTokenXXXXXXXXXXXXXXXXXXXXXX' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/rejected the bot token/);
    expect((await api('put', '', { enabled: true })).status).toBe(400);
  });

  it('saves a valid token (checked with Telegram) and never returns it', async () => {
    const res = await api('put', '', { botToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasToken: true, botUsername: 'mahali_alerts_bot', tokenHint: '123456789:••••hijk', enabled: false });
    expect(JSON.stringify((await api('get', '')).body)).not.toContain(TOKEN);
  });

  it('finds the chat after the owner pressed Start, and sends a test message', async () => {
    const res = await api('post', '/detect-chat');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ chatId: '777001', chatTitle: 'Ali' });
    expect((await api('post', '/test')).status).toBe(200);
    expect(sent.pop()).toMatchObject({ chat_id: '777001', parse_mode: 'HTML', text: expect.stringContaining('Test message') });
  });

  it('does not flood the chat with alerts raised before switching on', async () => {
    await sell('bulb', 6); // 10 -> 4: alert raised while alerts are off
    expect((await api('put', '', { enabled: true })).body.data.enabled).toBe(true);
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 0 });
    expect(sent).toHaveLength(0);
  });

  it('sends one alert when a sale (inside a transaction) crosses the threshold', async () => {
    await sell('fan', 3); // 10 -> 7, still above 5
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 0 });
    await sell('fan', 3); // 7 -> 4: crosses
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe('777001');
    expect(sent[0].text).toContain('<b>Ceiling Fan</b>');
    expect(sent[0].text).toContain('In stock: <b>4 pcs</b> (alert at 5)');

    // Further sales while still low: no repeat message.
    await sell('fan', 1);
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it('alerts again after the item was restocked and dropped once more', async () => {
    await restock('fan', 20); // 3 -> 23: alert auto-resolves
    await sell('fan', 20); // 23 -> 3: new alert
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 1 });
    expect(sent).toHaveLength(2);
  });

  it('groups several items into one message', async () => {
    await sell('cable', 10); // -> 0
    await restock('bulb', 10); // resolve the pre-switch-on alert
    await sell('bulb', 12); // 14 -> 2: new alert after switch-on
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 2 });
    expect(sent[2].text).toMatch(/^⚠️ <b>2 items need restocking<\/b>/);
    expect(sent[2].text).toContain('🔴 <b>Copper Cable 2.5mm</b>: 0 m left');
    expect(sent[2].text).toContain('🟠 <b>LED Bulb</b>: 2 pcs left');
  });

  it('keeps retrying while the internet is down, without giving up', async () => {
    await restock('fan', 20);
    await sell('fan', 20);
    sendMode = 'down';
    for (let i = 0; i < 7; i += 1) {
      const r = await telegram.sendPendingStockAlerts();
      expect(r).toMatchObject({ sent: 0, permanent: false });
    }
    expect((await telegram.getSettings()).lastError).toMatch(/Could not reach Telegram/);
    sendMode = 'ok';
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 1 });
    expect((await telegram.getSettings()).lastError).toBeNull();
  });

  it('gives up on an alert after Telegram refuses it 5 times', async () => {
    await restock('cable', 20);
    await sell('cable', 20);
    sendMode = 'reject';
    for (let i = 0; i < telegram.MAX_ATTEMPTS; i += 1) {
      expect(await telegram.sendPendingStockAlerts()).toMatchObject({ sent: 0, permanent: true });
    }
    expect((await telegram.getSettings()).lastError).toMatch(/cannot find that chat/);
    expect(await telegram.sendPendingStockAlerts()).toEqual({ sent: 0 }); // nothing left to try
    sendMode = 'ok';
  });

  it('stops sending when switched off', async () => {
    await api('put', '', { enabled: false });
    await restock('bulb', 20);
    await sell('bulb', 20);
    expect(await telegram.sendPendingStockAlerts()).toEqual({ skipped: 'disabled' });
  });
});
