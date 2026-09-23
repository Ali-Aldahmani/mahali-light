const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Matches the project's API response envelope:
// { success: false, error: { code, message, severity } }
function handler(_req, res) {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait and try again.',
      severity: 'warning',
    },
  });
}

// req.ip is the socket address, or — only when the request came through a
// trusted proxy (the Next.js /api rewrite, see utils/trustProxy.js) — the
// client address that proxy forwarded. Keying on the raw socket instead put
// every browser till in the Next process's single bucket. ipKeyGenerator
// normalises IPv6 notation variants.
function keyGenerator(req) {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
}

// Strict limiter for the login endpoint only.
// 20 attempts / 15 min per IP — sits on top of the per-username account lockout
// in authController.js (5 failures / 15 min) to also block credential stuffing
// attacks that cycle across many different usernames.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,   // sets RateLimit-* headers (RFC 6585 draft-7)
  legacyHeaders: false,     // disables deprecated X-RateLimit-* headers
  keyGenerator,
  handler,
});

// Global API limiter — protects every endpoint from being hammered.
// 500 req/min per IP is generous for a 5-PC LAN store (a busy cashier session
// generates roughly 20–30 requests per minute, so this leaves 10× headroom).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler,
});

// First-run setup code guesses (/api/setup/verify-code, /complete). The
// code is ~80 bits, so this is defence in depth, not the main barrier.
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler,
});

module.exports = { authLimiter, apiLimiter, setupLimiter };
