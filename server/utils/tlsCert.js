'use strict';
/**
 * TLS certificate loader / auto-generator for LAN HTTPS.
 *
 * Called at server startup when SERVER_USE_HTTPS=true.  Returns a
 * { cert, key } options object for https.createServer(), or null if no
 * certificate is available (caller falls back to HTTP and emits a warning).
 *
 * Resolution order:
 *   1. TLS_CERT_FILE + TLS_KEY_FILE env vars — paths to existing PEM files.
 *      Use this when you manage certs externally (Let's Encrypt, company CA).
 *   2. <TLS_DIR>/cert.pem + <TLS_DIR>/key.pem, where TLS_DIR defaults to
 *      <repo-root>/tls/.  Place pre-generated certs here and they are picked
 *      up automatically on every restart without further configuration.
 *   3. Auto-generate a self-signed cert into <TLS_DIR> using the `openssl`
 *      CLI.  Tried at PATH first, then common Windows install locations
 *      (Git-for-Windows, standalone OpenSSL installers).  The cert is reused
 *      on subsequent startups — generation runs once.
 *   4. Return null — caller opens plain HTTP and prints a warning.
 *
 * Self-signed cert details:
 *   • RSA 2048-bit, valid 10 years (3 650 days).
 *   • Subject Alternative Name (SAN) includes the SERVER_IP env var and
 *     127.0.0.1 so modern Chromium / Node.js TLS won't reject it solely
 *     because it only has a CN.
 *   • The openssl.cnf file is deleted after generation; cert.pem / key.pem
 *     remain on disk for reuse.
 */

const fs           = require('fs');
const path         = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTlsDir() {
  return process.env.TLS_DIR || path.resolve(__dirname, '..', '..', 'tls');
}

// Ordered list of openssl binary candidates on Windows.
const WIN_OPENSSL_CANDIDATES = [
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  'C:\\OpenSSL-Win64\\bin\\openssl.exe',
  'C:\\OpenSSL-Win32\\bin\\openssl.exe',
  'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
];

/**
 * Return the first openssl binary that responds to `openssl version`, or null.
 */
function findOpenssl() {
  const probe = spawnSync('openssl', ['version'], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
  });
  if (probe.status === 0) return 'openssl';

  if (process.platform === 'win32') {
    for (const bin of WIN_OPENSSL_CANDIDATES) {
      if (!fs.existsSync(bin)) continue;
      const check = spawnSync(bin, ['version'], {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
      });
      if (check.status === 0) return bin;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-generation
// ---------------------------------------------------------------------------

/**
 * Generate a self-signed cert + key into `dir` using openssl.
 * Returns true on success, false on any failure.
 */
function generateSelfSigned(dir) {
  const opensslBin = findOpenssl();
  if (!opensslBin) {
    console.warn(
      '[tls] openssl not found — cannot auto-generate self-signed cert.\n' +
      '[tls] Install Git-for-Windows (includes openssl) or place cert.pem / key.pem in ' +
      dir,
    );
    return false;
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn('[tls] could not create TLS directory:', err.message);
    return false;
  }

  const certPath = path.join(dir, 'cert.pem');
  const keyPath  = path.join(dir, 'key.pem');
  const cnfPath  = path.join(dir, 'openssl.cnf');

  // Subject Alternative Names are required by modern Chromium/Node TLS.
  // We add the configured server IP and the loopback so both LAN and local
  // connections are covered by a single cert.
  const serverIp = process.env.SERVER_IP || '127.0.0.1';
  const cnfContent = [
    '[req]',
    'distinguished_name = dn',
    'req_extensions     = san',
    'prompt             = no',
    '',
    '[dn]',
    'CN = mahali-pos-server',
    'O  = Mahali',
    'C  = AE',
    '',
    '[san]',
    'keyUsage           = keyEncipherment, dataEncipherment',
    'extendedKeyUsage   = serverAuth',
    `subjectAltName     = IP:${serverIp}, IP:127.0.0.1`,
  ].join('\n');

  try {
    fs.writeFileSync(cnfPath, cnfContent, 'utf8');
  } catch (err) {
    console.warn('[tls] could not write openssl.cnf:', err.message);
    return false;
  }

  const result = spawnSync(
    opensslBin,
    [
      'req', '-x509',
      '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out',    certPath,
      '-days',   '3650',
      '-nodes',                   // no passphrase on the key
      '-config',     cnfPath,
      '-extensions', 'san',
    ],
    { timeout: 30_000, windowsHide: true },
  );

  // Always remove the temp config, even on failure.
  try { fs.unlinkSync(cnfPath); } catch (_) {}

  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || Buffer.alloc(0)).toString().trim();
    console.warn('[tls] openssl certificate generation failed:', msg || `exit ${result.status}`);
    return false;
  }

  console.log(`[tls] self-signed certificate generated and saved to ${dir}`);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load TLS options for https.createServer().
 *
 * Only runs when SERVER_USE_HTTPS=true — returns null immediately for any
 * other value so development environments are never affected.
 *
 * @returns {{ cert: Buffer, key: Buffer } | null}
 */
function loadTlsOptions() {
  // Opt-in guard — skip HTTPS in development unless explicitly requested.
  if (process.env.SERVER_USE_HTTPS !== 'true') return null;

  // ── 1. Explicit env var paths ─────────────────────────────────────────────
  const envCert = process.env.TLS_CERT_FILE;
  const envKey  = process.env.TLS_KEY_FILE;
  if (envCert || envKey) {
    if (envCert && envKey && fs.existsSync(envCert) && fs.existsSync(envKey)) {
      try {
        console.log('[tls] loading certificate from TLS_CERT_FILE / TLS_KEY_FILE');
        return { cert: fs.readFileSync(envCert), key: fs.readFileSync(envKey) };
      } catch (err) {
        console.warn('[tls] failed to read TLS_CERT_FILE / TLS_KEY_FILE:', err.message);
      }
    } else {
      console.warn('[tls] TLS_CERT_FILE / TLS_KEY_FILE set but one or both files are missing — trying default location');
    }
  }

  // ── 2. Default directory ──────────────────────────────────────────────────
  const dir      = getTlsDir();
  const certPath = path.join(dir, 'cert.pem');
  const keyPath  = path.join(dir, 'key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      console.log(`[tls] loading certificate from ${dir}`);
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } catch (err) {
      console.warn('[tls] failed to read cert.pem / key.pem from TLS_DIR:', err.message);
    }
  }

  // ── 3. Auto-generate ──────────────────────────────────────────────────────
  if (generateSelfSigned(dir)) {
    try {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } catch (err) {
      console.warn('[tls] generated cert is unreadable:', err.message);
    }
  }

  // ── 4. Fall through ───────────────────────────────────────────────────────
  return null;
}

module.exports = { loadTlsOptions };
