/**
 * Every signed-in API route checks a permission (authentication audit
 * AUTH-11 hardening): a new route that forgets requirePermission /
 * requireAnyPermission fails here, unless it is listed in OPEN_TO_ANY_USER
 * with the reason it is safe for any signed-in user.
 *
 * Walks each router in server/routes. A route counts as signed-in when
 * requireAuth runs before it (router-level or on the route), and as checked
 * when a permission middleware runs before its handler.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const routesDir = path.resolve(__dirname, '../../server/routes');

// "file METHOD /path": why any signed-in user may call it.
const OPEN_TO_ANY_USER = {
  // The signed-in user's own session.
  'auth.js POST /logout': 'own session',
  'auth.js POST /logout-all': 'own sessions',
  'auth.js POST /refresh': 'own session',
  'auth.js GET /me': 'own profile',
  // The signed-in user's own notifications (queries filter by req.user.id).
  'notifications.js GET /preferences': 'own preferences',
  'notifications.js PUT /preferences': 'own preferences',
  'notifications.js GET /unread-count': 'own notifications',
  'notifications.js GET /': 'own notifications',
  'notifications.js PUT /read-all': 'own notifications',
  'notifications.js PUT /:id/read': 'own notifications',
  'notifications.js PUT /:id/unread': 'own notifications',
  'notifications.js PUT /:id/pin': 'own notifications',
  'notifications.js DELETE /:id/pin': 'own notifications',
  'notifications.js PUT /:id/dismiss': 'own notifications',
  // Checked inside the handler.
  'attendance.js GET /:employeeId': 'own record with view_own, anyone with view_all (selfOrViewAll)',
  'attendance.js GET /:employeeId/summary': 'own record with view_own, anyone with view_all (selfOrViewAll)',
  'leaveBalances.js GET /:employeeId': 'own balance with view_own, anyone with view_all',
  'analytics.js GET /employee-performance': 'own figures, or everyone with report.employee_performance_all',
  'reports.js GET /registry': 'lists only the reports the user\'s permissions allow',
  'reports.js GET /:type': 'checkPermission(req, type) per report',
  'reports.js GET /:type/export': 'per-report permission checked before export',
  'search.js GET /': 'each result type filtered by the user\'s permissions',
  'updates.js GET /check': 'requireAdmin in the controller',
  'updates.js GET /status': 'requireAdmin in the controller',
  'updates.js POST /install': 'requireAdmin in the controller',
  // Safe for any signed-in user.
  'backup.js GET /status': 'whether a restore is running, so every screen can pause',
  'bugReports.js POST /': 'anyone can report a bug',
  'holidays.js GET /': 'the shop\'s public holiday list',
  'print.js GET /printers': 'a fixed note; no data',
  'settings.js GET /store': 'store name, address and VAT number printed on every receipt',
};

function routerOf(mod) {
  if (typeof mod === 'function' && Array.isArray(mod.stack)) return mod;
  for (const v of Object.values(mod || {})) {
    if (typeof v === 'function' && Array.isArray(v.stack)) return v;
    if (typeof v === 'function' && /Router$/.test(v.name || '')) {
      try {
        const r = v();
        if (r && Array.isArray(r.stack)) return r;
      } catch (_e) { /* not a factory */ }
    }
  }
  return null;
}

function routesIn(file) {
  const router = routerOf(require(path.join(routesDir, file)));
  if (!router) return [];
  const out = [];
  let authBefore = false;
  let permBefore = false;
  for (const layer of router.stack) {
    if (!layer.route) {
      if (layer.handle?.requiresAuth) authBefore = true;
      if (layer.handle?.permissionCheck) permBefore = true;
      continue;
    }
    const handles = layer.route.stack.map((l) => l.handle);
    const auth = authBefore || handles.some((h) => h.requiresAuth);
    const perm = permBefore || handles.some((h) => h.permissionCheck);
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ id: `${file} ${method.toUpperCase()} ${layer.route.path}`, auth, perm });
    }
  }
  return out;
}

const routes = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).flatMap(routesIn);

describe('route permissions', () => {
  it('finds the routers', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every signed-in route checks a permission or is listed as open to any user', () => {
    const unchecked = routes
      .filter((r) => r.auth && !r.perm && !OPEN_TO_ANY_USER[r.id])
      .map((r) => r.id);
    expect(unchecked).toEqual([]);
  });

  it('the open list has no stale entries', () => {
    const ids = new Set(routes.filter((r) => r.auth && !r.perm).map((r) => r.id));
    expect(Object.keys(OPEN_TO_ANY_USER).filter((id) => !ids.has(id))).toEqual([]);
  });
});
