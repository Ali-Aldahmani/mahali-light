import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');
const { configureTrustProxy, parseEntries } = require('../../server/utils/trustProxy');
const { authLimiter } = require('../../server/middleware/rateLimiter');

async function ipApp(trusted) {
  const app = express();
  await configureTrustProxy(app, trusted);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

const bare = (ip) => String(ip).replace(/^::ffff:/, '');

describe('trusted proxy client IPs', () => {
  it('defaults to trusting loopback only', () => {
    expect(parseEntries(undefined)).toEqual(['loopback']);
    expect(parseEntries(' nextjs , 10.0.0.0/8 ')).toEqual(['nextjs', '10.0.0.0/8']);
  });

  it('uses the forwarded client address from a trusted proxy', async () => {
    const res = await request(await ipApp('loopback')).get('/ip').set('X-Forwarded-For', '192.168.1.41');
    expect(res.body.ip).toBe('192.168.1.41');
  });

  it('resolves hostnames (e.g. the nextjs container) to trusted addresses', async () => {
    const res = await request(await ipApp('localhost')).get('/ip').set('X-Forwarded-For', '192.168.1.42');
    expect(res.body.ip).toBe('192.168.1.42');
  });

  it('ignores X-Forwarded-For from an untrusted caller (a till calling the API directly)', async () => {
    const res = await request(await ipApp('203.0.113.5')).get('/ip').set('X-Forwarded-For', '192.168.1.43');
    expect(bare(res.body.ip)).toBe('127.0.0.1');
  });

  it('gives each till behind the proxy its own login rate-limit bucket', async () => {
    const app = express();
    await configureTrustProxy(app, 'loopback');
    app.post('/login', authLimiter, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post('/login').set('X-Forwarded-For', '192.168.1.50');
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/login').set('X-Forwarded-For', '192.168.1.50');
    expect(blocked.status).toBe(429);

    // A different till is unaffected — previously every browser till shared one bucket.
    const other = await request(app).post('/login').set('X-Forwarded-For', '192.168.1.51');
    expect(other.status).toBe(200);
  });
});

describe('web/forwarded-for.cjs (Next.js edge)', () => {
  it('replaces a client-supplied X-Forwarded-For with the real socket address', () => {
    const preload = path.resolve(__dirname, '../../web/forwarded-for.cjs');
    const script = `
      const http = require('http');
      const server = http.createServer((req, res) => res.end(JSON.stringify({
        xff: req.headers['x-forwarded-for'], realIp: req.headers['x-real-ip'] ?? null,
      })));
      server.listen(0, '127.0.0.1', () => {
        http.get({ port: server.address().port, host: '127.0.0.1',
          headers: { 'X-Forwarded-For': '6.6.6.6', 'X-Real-IP': '6.6.6.6' } }, (res) => {
          let body = ''; res.on('data', (c) => (body += c));
          res.on('end', () => { console.log(body); server.close(); });
        });
      });`;
    const out = execFileSync(process.execPath, ['--require', preload, '-e', script], { encoding: 'utf8' });
    const { xff, realIp } = JSON.parse(out.trim());
    expect(bare(xff)).toBe('127.0.0.1');
    expect(realIp).toBeNull();
  });
});
