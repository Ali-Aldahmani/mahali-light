// Simple in-memory maintenance flag. While true, the API short-circuits with
// 503 for everything except a tiny allow-list (status checks, login). This
// keeps the restore process from racing with live writes.
let active = false;
let reason = null;
let since = null;

function enable(why = 'Maintenance in progress') {
  active = true;
  reason = why;
  since = new Date().toISOString();
}

function disable() {
  active = false;
  reason = null;
  since = null;
}

function isActive() {
  return active;
}

function status() {
  return { active, reason, since };
}

// Routes that stay open even during restore so admins can still observe
// progress and the login screen can render.
const ALLOWED_PREFIXES = [
  '/api/auth/me',
  '/api/backup/status',
  '/api/backup/jobs',
  '/health',
];

function middleware() {
  return (req, res, next) => {
    if (!active) return next();
    if (req.method === 'GET' && ALLOWED_PREFIXES.some((p) => req.path.startsWith(p))) {
      return next();
    }
    res.status(503).json({
      ok: false,
      error: {
        code: 'BIZ_MAINTENANCE_MODE',
        message: reason || 'The system is currently in maintenance mode.',
        since,
      },
    });
  };
}

module.exports = { enable, disable, isActive, status, middleware };
