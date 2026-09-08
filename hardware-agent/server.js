#!/usr/bin/env node
/**
 * Local Hardware Agent — localhost-only. No POS business logic, no PostgreSQL.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.HARDWARE_AGENT_PORT || 17473);
const EXPRESS_URL = (process.env.EXPRESS_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DIR = process.env.HARDWARE_AGENT_DIR || path.join(os.homedir(), '.bytecra-hardware-agent');
const TOKEN_FILE = path.join(DIR, 'pairing-token');
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureToken() {
  fs.mkdirSync(DIR, { mode: 0o700, recursive: true });
  if (!fs.existsSync(TOKEN_FILE)) {
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    console.log('[hardware-agent] pairing token written to', TOKEN_FILE);
    console.log('[hardware-agent] paste this token once in POS Settings → Printers (this PC only).');
  }
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function authorized(req, token) {
  return (req.headers['x-hardware-token'] || '') === token;
}

function listPrinters() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'wmic' : 'lpstat';
    const args = process.platform === 'win32' ? ['printer', 'get', 'name'] : ['-p'];
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      const names = out
        .split(/\r?\n/)
        .map((l) => l.replace(/^printer\s+/i, '').split(/\s+/)[0])
        .filter((n) => n && n.toLowerCase() !== 'name');
      resolve(names.map((name) => ({ name })));
    });
  });
}

async function fetchPdf({ kind, invoiceId, apiToken }) {
  const suffix = kind === 'receipt' ? 'receipt' : 'pdf';
  const url = `${EXPRESS_URL}/api/invoices/${invoiceId}/${suffix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res.ok) {
    const err = new Error('PDF_FETCH_FAILED');
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

function printBuffer(buf, printer, copies) {
  const tmp = path.join(os.tmpdir(), `bytecra-print-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  return new Promise((resolve, reject) => {
    const n = Math.min(Math.max(Number(copies) || 1, 1), 5);
    let args;
    let cmd;
    if (process.platform === 'darwin' || process.platform === 'linux') {
      cmd = 'lp';
      args = ['-n', String(n), tmp];
      if (printer) args.splice(1, 0, '-d', printer);
    } else {
      cmd = 'cmd';
      args = ['/c', 'start', '/min', tmp];
    }
    const child = spawn(cmd, args, { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      if (code === 0) resolve({ printed: true });
      else reject(new Error(`PRINT_FAILED_${code}`));
    });
  });
}

async function handle(req, res, token) {
  const url = new URL(req.url, `http://${HOST}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { success: true, data: { status: 'ok', service: 'hardware-agent' } });
  }
  if (req.method === 'GET' && url.pathname === '/v1/printers') {
    if (!authorized(req, token)) return json(res, 401, { success: false, error: { code: 'HW_UNAUTHORIZED' } });
    const printers = await listPrinters();
    return json(res, 200, { success: true, data: printers });
  }
  if (req.method === 'POST' && url.pathname === '/v1/print') {
    if (!authorized(req, token)) return json(res, 401, { success: false, error: { code: 'HW_UNAUTHORIZED' } });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return json(res, 400, { success: false, error: { code: 'HW_BAD_JSON' } });
    }
    const kind = body.kind === 'receipt' ? 'receipt' : body.kind === 'invoice' ? 'invoice' : null;
    if (!kind || !UUID_RE.test(String(body.invoiceId || ''))) {
      return json(res, 400, { success: false, error: { code: 'HW_INVALID_PRINT' } });
    }
    if (!body.apiToken || typeof body.apiToken !== 'string') {
      return json(res, 400, { success: false, error: { code: 'HW_MISSING_API_TOKEN' } });
    }
    try {
      const pdf = await fetchPdf({ kind, invoiceId: body.invoiceId, apiToken: body.apiToken });
      await printBuffer(pdf, body.printer, body.copies);
      return json(res, 200, { success: true, data: { printed: true } });
    } catch (err) {
      return json(res, err.status || 502, {
        success: false,
        error: { code: 'HW_PRINT_FAILED', message: String(err.message || err) },
      });
    }
  }
  return json(res, 404, { success: false, error: { code: 'HW_UNKNOWN_COMMAND' } });
}

const token = ensureToken();
const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    json(res, 403, { success: false, error: { code: 'HW_LOCALHOST_ONLY' } });
    return;
  }
  handle(req, res, token).catch(() => {
    json(res, 500, { success: false, error: { code: 'HW_INTERNAL' } });
  });
});
server.listen(PORT, HOST, () => {
  console.log(`[hardware-agent] listening on http://${HOST}:${PORT}`);
});
