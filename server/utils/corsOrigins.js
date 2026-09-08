function extraOrigins() {
  return new Set(
    (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

/**
 * Credentialed CORS: explicit list, Electron Origin "null", or the configured
 * SERVER_IP / loopback on http(s). Not a wildcard.
 */
function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  if (extraOrigins().has(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const serverIp = (process.env.SERVER_IP || '').trim();
  if (serverIp && host === serverIp) return true;
  return false;
}

module.exports = { extraOrigins, isAllowedOrigin };
