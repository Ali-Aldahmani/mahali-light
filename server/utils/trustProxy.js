const dns = require('dns').promises;
const net = require('net');

// Which upstream hops may set X-Forwarded-For. Browsers reach the API
// through the Next.js /api rewrite, so without this every till shares the
// Next process's address: one login rate-limit bucket for the whole store,
// and every login audit row records the same IP.
//
// TRUSTED_PROXIES is a comma list of IPs, CIDRs, Express keywords
// (loopback, linklocal, uniquelocal) or hostnames. Hostnames are resolved
// now and re-resolved periodically, since a container's IP changes when it
// restarts. Default "loopback" covers native installs where Next runs on
// the same machine. Docker sets it to the `nextjs` service. Tills that call
// the API directly are never trusted, so their X-Forwarded-For is ignored.
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const REFRESH_MS = 60 * 1000;

function parseEntries(raw) {
  const value = raw == null || String(raw).trim() === '' ? 'loopback' : String(raw);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function isLiteral(entry) {
  return KEYWORDS.has(entry) || net.isIP(entry.split('/')[0]) !== 0;
}

async function resolveEntries(entries) {
  const out = [];
  for (const entry of entries) {
    if (isLiteral(entry)) {
      out.push(entry);
      continue;
    }
    try {
      const addrs = await dns.lookup(entry, { all: true });
      for (const { address } of addrs) out.push(address);
    } catch (err) {
      // Not resolvable yet (e.g. container still starting) — trust nothing
      // for it this round; falling back to the socket address is safe.
      console.warn(`[trustProxy] cannot resolve "${entry}": ${err.code || err.message}`);
    }
  }
  return [...new Set(out)];
}

async function configureTrustProxy(app, raw = process.env.TRUSTED_PROXIES) {
  const entries = parseEntries(raw);
  let current = null;
  const apply = async () => {
    const list = await resolveEntries(entries);
    const key = list.join(',');
    if (key === current) return;
    current = key;
    // Express compiles this list and consults it on every req.ip read.
    app.set('trust proxy', list.length ? list : false);
    console.log(`[trustProxy] trusting X-Forwarded-For from: ${key || '(nothing)'}`);
  };
  await apply();
  const needsRefresh = entries.some((e) => !isLiteral(e));
  if (needsRefresh) {
    const timer = setInterval(() => {
      apply().catch((err) => console.warn('[trustProxy] refresh failed', err.message));
    }, REFRESH_MS);
    timer.unref();
  }
}

module.exports = { configureTrustProxy, parseEntries, resolveEntries };
