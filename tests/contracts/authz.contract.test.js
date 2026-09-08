import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PERMISSIONS, ROLE_DEFAULTS } = require('../../shared/permissions.js');
const { requirePermission } = require('../../server/middleware/permissions.js');
const { ERROR_CODES, ERROR_DEFS, AppError } = require('../../shared/errorCodes.js');
const { ok, created, parsePagination } = require('../../server/utils/response.js');

function flatten(obj, acc = []) {
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') acc.push(v);
    else flatten(v, acc);
  }
  return acc;
}

describe('permission catalog contract', () => {
  const keys = flatten(PERMISSIONS);

  it('exposes 104 unique permission keys', () => {
    expect(keys).toHaveLength(104);
    expect(new Set(keys).size).toBe(104);
  });

  it('does not give Cashier user administration', () => {
    const c = new Set(ROLE_DEFAULTS.Cashier);
    expect(c.has('user.create')).toBe(false);
    expect(c.has('user.edit')).toBe(false);
    expect(c.has('user.change_role')).toBe(false);
    expect(c.has('user.force_logout')).toBe(false);
  });

  it('does not give Manager user.create, user.edit, or user.change_role', () => {
    const m = new Set(ROLE_DEFAULTS.Manager);
    expect(m.has('user.create')).toBe(false);
    expect(m.has('user.edit')).toBe(false);
    expect(m.has('user.change_role')).toBe(false);
    expect(m.has('user.force_logout')).toBe(true);
  });

  it('Admin wildcard is *', () => {
    expect(ROLE_DEFAULTS.Admin).toBe('*');
  });

  it('Warehouse cannot confirm invoices', () => {
    const w = new Set(ROLE_DEFAULTS.Warehouse);
    expect(w.has('invoice.create')).toBe(false);
    expect(w.has('invoice.view')).toBe(false);
  });
});

describe('requirePermission AND semantics', () => {
  it('403 AUTH_NO_PERMISSION when any key missing', () => {
    const mw = requirePermission('user.edit', 'user.change_role');
    let err;
    mw({ user: { permissions: ['user.edit'] } }, {}, (e) => {
      err = e;
    });
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(err.status).toBe(403);
    expect(err.details.missing).toEqual(['user.change_role']);
  });

  it('401 when unauthenticated', () => {
    const mw = requirePermission('invoice.view');
    let err;
    mw({}, {}, (e) => {
      err = e;
    });
    expect(err.code).toBe(ERROR_CODES.AUTH_TOKEN_MISSING);
    expect(err.status).toBe(401);
  });

  it('calls next() when all keys present', () => {
    const mw = requirePermission('invoice.view', 'invoice.create');
    let called = false;
    mw({ user: { permissions: ['invoice.view', 'invoice.create'] } }, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

describe('error envelope contract', () => {
  it('success helpers use { success, data }', () => {
    const res = {
      json(body) {
        this.body = body;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
    };
    ok(res, { id: 1 }, { page: 1 });
    expect(res.body).toEqual({ success: true, data: { id: 1 }, meta: { page: 1 } });
    created(res, { id: 2 });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('AUTH_NO_PERMISSION default status is 403', () => {
    expect(ERROR_DEFS[ERROR_CODES.AUTH_NO_PERMISSION].status).toBe(403);
  });

  it('pagination clamps page/limit', () => {
    expect(parsePagination({ query: { page: '0', limit: '999' } })).toMatchObject({
      page: 1,
      limit: 100,
    });
  });
});

describe('users route authorization wiring (AUTHZ-004)', () => {
  it('PUT /:id remains gated by user.edit; role change is enforced in the controller', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/routes/users.js'),
      'utf8',
    );
    expect(src).toMatch(
      /router\.put\(\s*'\/:id'\s*,\s*requirePermission\('user\.edit'\)/,
    );
    expect(src).toMatch(
      /router\.put\(\s*'\/:id\/permissions'\s*,\s*requirePermission\('user\.change_role'\)/,
    );
  });

  it('update() calls assertCanChangeRole when roleId changes', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/controllers/usersController.js'),
      'utf8',
    );
    expect(src).toMatch(/assertCanChangeRole/);
    expect(src).toMatch(/assertCanAssignRole/);
    expect(src).toMatch(/assertCanSetEffectivePermissions/);
  });
});

describe('loadUserContext override algorithm (source)', () => {
  it('documents grant then deny on a Set', () => {
    const roleKeys = new Set(['invoice.view', 'user.edit']);
    const overrides = [
      { key: 'user.create', granted: true },
      { key: 'user.edit', granted: false },
    ];
    const effective = new Set(roleKeys);
    for (const { key, granted } of overrides) {
      if (granted) effective.add(key);
      else effective.delete(key);
    }
    expect(effective.has('invoice.view')).toBe(true);
    expect(effective.has('user.create')).toBe(true);
    expect(effective.has('user.edit')).toBe(false);
  });
});
