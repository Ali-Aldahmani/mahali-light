/**
 * Security regression: privilege escalation using current Express rules.
 * These tests freeze behavior. They do not patch AUTHZ-004.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ROLE_DEFAULTS } = require('../../shared/permissions.js');
const { requirePermission } = require('../../server/middleware/permissions.js');
const { ERROR_CODES } = require('../../shared/errorCodes.js');

function asUser(roleName, extra = []) {
  const base = ROLE_DEFAULTS[roleName];
  const permissions = base === '*' ? ['*'] : [...base, ...extra];
  return { user: { id: 'self', username: 't', permissions, role_name: roleName } };
}

function deny(roleName, keys) {
  const perms = ROLE_DEFAULTS[roleName].filter((k) => !keys.includes(k));
  return { user: { permissions: perms } };
}

function run(keys, req) {
  let err = null;
  let ok = false;
  requirePermission(...keys)(req, {}, (e) => {
    if (e) err = e;
    else ok = true;
  });
  return { err, ok };
}

describe('privilege escalation regressions', () => {
  it('Cashier cannot hit user.create / user.edit / user.change_role', () => {
    const req = asUser('Cashier');
    for (const key of ['user.create', 'user.edit', 'user.change_role', 'user.force_logout']) {
      const { err } = run([key], req);
      expect(err?.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
      expect(err?.details.missing).toContain(key);
    }
  });

  it('Manager cannot assign roles via user.change_role or edit users', () => {
    const req = asUser('Manager');
    expect(run(['user.change_role'], req).err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(run(['user.edit'], req).err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(run(['user.create'], req).err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
  });

  it('Manager can force-logout (default seed)', () => {
    expect(run(['user.force_logout'], asUser('Manager')).ok).toBe(true);
  });

  it('Manager cannot grant backup.restore or settings.edit by default', () => {
    const req = asUser('Manager');
    expect(run(['backup.restore'], req).err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(run(['settings.edit'], req).err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
  });

  it('deny override removes a role permission', () => {
    const req = deny('Manager', ['invoice.cancel']);
    const { err } = run(['invoice.cancel'], req);
    expect(err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
  });

  it('grant override adds a permission the role lacks', () => {
    const req = asUser('Cashier', ['user.force_logout']);
    expect(run(['user.force_logout'], req).ok).toBe(true);
  });

  it('Warehouse cannot open POS confirm (invoice.create)', () => {
    expect(run(['invoice.create'], asUser('Warehouse')).err.code).toBe(
      ERROR_CODES.AUTH_NO_PERMISSION,
    );
  });

  it('PermissionGate is not referenced by Express routers', () => {
    const dir = path.join(process.cwd(), 'server/routes');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/PermissionGate/);
    }
  });
});
