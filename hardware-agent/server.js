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
// Browsers check before calling a local service from a web page (CORS and
// Private Network Access). The agent never answered that check, so every print
// from the POS fell back silently (review 5 Nov). Set HARDWARE_AGENT_ORIGINS to
// the POS address(es), comma-separated, to allow only those; when it is not
// set, any page may ask, and the pairing token is still required for printing.
const ALLOWED_ORIGINS = (process.env.HARDWARE_AGENT_ORIGINS || '')
  .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Hardware-Token',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

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
    ...(res.corsHeaders || {}),
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function authorized(req, token) {
  const given = Buffer.from(String(req.headers['x-hardware-token'] || ''));
  const expected = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function listPrinters() {
  return new Promise((resolve) => {
    // wmic is gone from recent Windows 11; PowerShell's Get-Printer lists one
    // full name per line. lpstat lines read "printer NAME is ...".
    const cmd = process.platform === 'win32' ? 'powershell.exe' : 'lpstat';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | ForEach-Object { $_.Name }']
      : ['-p'];
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      // Whole names: "HP LaserJet 400" used to come back as "HP".
      const names = out
        .split(/\r?\n/)
        .map((l) => (process.platform === 'win32'
          ? l.trim()
          : (l.match(/^printer\s+(.+?)\s+(is|disabled|now)\b/i) || [])[1] || ''))
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

const PRINT_SCRIPT = path.join(__dirname, 'print.ps1');

function printBuffer(buf, printer, copies) {
  // Random, so two prints in the same millisecond can't overwrite each other.
  const tmp = path.join(os.tmpdir(), `bytecra-print-${crypto.randomUUID()}.pdf`);
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
      // Windows has no CLI print-to-printer without a bundled binary; invoke the
      // OS-registered PDF handler's Print/PrintTo verb via PowerShell instead of
      // just opening a viewer window. Args are passed positionally (not through
      // a shell string), so a printer name can't inject PowerShell commands.
      cmd = 'powershell';
      args = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        PRINT_SCRIPT,
        '-Path',
        tmp,
        '-Copies',
        String(n),
      ];
      if (printer) args.push('-Printer', printer);
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
  res.corsHeaders = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, res.corsHeaders);
    res.end();
    return;
  }
  handle(req, res, token).catch(() => {
    json(res, 500, { success: false, error: { code: 'HW_INTERNAL' } });
  });
});
server.listen(PORT, HOST, () => {
  console.log(`[hardware-agent] listening on http://${HOST}:${PORT}`);
});
