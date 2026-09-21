import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ERROR_CODES, AppError } = require('../../shared/errorCodes.js');
const {
  ROLE_RANK,
  ADMIN_EXCLUSIVE_PERMISSIONS,
  isAdminActor,
  assertCanAssignRole,
  assertCanChangeRole,
  assertCanSetEffectivePermissions,
  assertCanAssignPermissionKeys,
  assertCanManageTarget,
} = require('../../shared/authzPolicy.js');
const { ROLE_DEFAULTS } = require('../../shared/permissions.js');

function admin() {
  return {
    id: 'admin-1',
    role: 'Admin',
    role_is_system: true,
    permissions: ['user.change_role', 'user.edit', 'user.create', ...ADMIN_EXCLUSIVE_PERMISSIONS, 'invoice.view'],
  };
}

function manager(extra = []) {
  return {
    id: 'mgr-1',
    role: 'Manager',
    permissions: [...ROLE_DEFAULTS.Manager, ...extra],
  };
}

function cashier(extra = []) {
  return {
    id: 'csh-1',
    role: 'Cashier',
    permissions: [...ROLE_DEFAULTS.Cashier, ...extra],
  };
}

function warehouse(extra = []) {
  return {
    id: 'wh-1',
    role: 'Warehouse',
    permissions: [...ROLE_DEFAULTS.Warehouse, ...extra],
  };
}

function expectDenied(fn, reason) {
  try {
    fn();
    throw new Error('expected deny');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(err.status).toBe(403);
    if (reason) expect(err.details.reason).toBe(reason);
  }
}

describe('AUTHZ-004 role assignment', () => {
  it('ranks Admin above Manager above Cashier/Warehouse peers', () => {
    expect(ROLE_RANK.Admin).toBeGreaterThan(ROLE_RANK.Manager);
    expect(ROLE_RANK.Manager).toBeGreaterThan(ROLE_RANK.Cashier);
    expect(ROLE_RANK.Cashier).toBe(ROLE_RANK.Warehouse);
  });

  it('Admin may assign the system Admin role', () => {
    expect(() =>
      assertCanAssignRole({
        actor: admin(),
        newRoleName: 'Admin',
        newRoleIsSystem: true,
      }),
    ).not.toThrow();
  });

  it('Manager cannot assign Admin or Manager', () => {
    expectDenied(
      () => assertCanAssignRole({ actor: manager(['user.create']), newRoleName: 'Admin' }),
      'cannot_assign_admin',
    );
    expectDenied(
      () => assertCanAssignRole({ actor: manager(['user.create']), newRoleName: 'Manager' }),
      'hierarchy',
    );
  });

  it('Manager may assign Cashier or Warehouse', () => {
    expect(() =>
      assertCanAssignRole({ actor: manager(['user.create']), newRoleName: 'Cashier' }),
    ).not.toThrow();
    expect(() =>
      assertCanAssignRole({ actor: manager(['user.create']), newRoleName: 'Warehouse' }),
    ).not.toThrow();
  });

  it('blocks self-promotion via role change', () => {
    expectDenied(
      () =>
        assertCanChangeRole({
          actor: { ...manager(['user.change_role']), id: 'self' },
          targetUserId: 'self',
          currentRoleName: 'Manager',
          newRoleName: 'Admin',
        }),
      'self_modification',
    );
  });

  it('role change without user.change_role is denied even if user.edit is held', () => {
    expectDenied(
      () =>
        assertCanChangeRole({
          actor: { id: 'a', role: 'Admin', permissions: ['user.edit'] },
          targetUserId: 'b',
          currentRoleName: 'Cashier',
          newRoleName: 'Manager',
        }),
      'role_change_permission',
    );
  });

  it('Admin with user.change_role may promote Cashier to Manager', () => {
    expect(() =>
      assertCanChangeRole({
        actor: admin(),
        targetUserId: 'csh',
        currentRoleName: 'Cashier',
        newRoleName: 'Manager',
      }),
    ).not.toThrow();
  });
});

// MED-03: usersController.forceLogout now calls assertCanManageTarget the
// same way role/permission changes already did, so a Manager (who holds
// user.force_logout by default) cannot forcibly disconnect the Admin.
describe('isAdminActor', () => {
  it('requires the seeded system Admin role, not the display name alone', () => {
    expect(isAdminActor(admin())).toBe(true);
    expect(isAdminActor({ role: 'Admin', role_is_system: false })).toBe(false);
    expect(isAdminActor({ role: 'Manager', role_is_system: true })).toBe(false);
  });
});

describe('assertCanAssignRole (system Admin role)', () => {
  it('rejects assigning a non-system role named Admin', () => {
    expectDenied(
      () =>
        assertCanAssignRole({
          actor: admin(),
          newRoleName: 'Admin',
          newRoleIsSystem: false,
        }),
      'invalid_admin_role',
    );
  });
});

describe('assertCanManageTarget (force-logout rank check)', () => {
  it('Manager cannot manage/force-logout Admin', () => {
    expectDenied(
      () =>
        assertCanManageTarget({
          actor: manager(['user.force_logout']),
          targetRoleName: 'Admin',
          targetUserId: 'admin-1',
        }),
      'hierarchy',
    );
  });

  it('Manager can manage/force-logout Cashier (strictly lower rank)', () => {
    expect(() =>
      assertCanManageTarget({
        actor: manager(['user.force_logout']),
        targetRoleName: 'Cashier',
        targetUserId: 'csh-1',
      }),
    ).not.toThrow();
  });

  it('Manager cannot manage a peer Manager', () => {
    expectDenied(
      () =>
        assertCanManageTarget({
          actor: manager(['user.force_logout']),
          targetRoleName: 'Manager',
          targetUserId: 'mgr-2',
        }),
      'hierarchy',
    );
  });

  it('Admin can manage anyone, including another Admin', () => {
    expect(() =>
      assertCanManageTarget({ actor: admin(), targetRoleName: 'Admin', targetUserId: 'admin-2' }),
    ).not.toThrow();
  });

  it('blocks self-targeting regardless of role', () => {
    expectDenied(
      () =>
        assertCanManageTarget({
          actor: { ...admin(), id: 'self' },
          targetRoleName: 'Admin',
          targetUserId: 'self',
        }),
      'self_modification',
    );
  });
});

describe('setPermissions delegation', () => {
  it('Admin may grant exclusive keys to a Manager', () => {
    expect(() =>
      assertCanSetEffectivePermissions({
        actor: admin(),
        targetUserId: 'mgr-2',
        targetRoleName: 'Manager',
        roleKeys: ROLE_DEFAULTS.Manager,
        desiredKeys: [...ROLE_DEFAULTS.Manager, 'user.edit'],
      }),
    ).not.toThrow();
  });

  it('cannot modify own permission overrides', () => {
    expectDenied(
      () =>
        assertCanSetEffectivePermissions({
          actor: admin(),
          targetUserId: 'admin-1',
          targetRoleName: 'Admin',
          roleKeys: ['invoice.view'],
          desiredKeys: ['invoice.view', 'user.edit'],
        }),
      'self_modification',
    );
  });

  it('Manager cannot administer another Manager', () => {
    expectDenied(
      () =>
        assertCanSetEffectivePermissions({
          actor: manager(['user.change_role']),
          targetUserId: 'mgr-2',
          targetRoleName: 'Manager',
          roleKeys: ROLE_DEFAULTS.Manager,
          desiredKeys: ROLE_DEFAULTS.Manager,
        }),
      'hierarchy',
    );
  });

  it('Manager with user.change_role cannot grant exclusive or unowned keys', () => {
    expectDenied(
      () =>
        assertCanSetEffectivePermissions({
          actor: manager(['user.change_role']),
          targetUserId: 'csh-2',
          targetRoleName: 'Cashier',
          roleKeys: ROLE_DEFAULTS.Cashier,
          desiredKeys: [...ROLE_DEFAULTS.Cashier, 'user.change_role'],
        }),
      'delegation',
    );
  });

  it('Manager may grant a key they hold (invoice.cancel) to Cashier', () => {
    expect(() =>
      assertCanSetEffectivePermissions({
        actor: manager(['user.change_role']),
        targetUserId: 'csh-2',
        targetRoleName: 'Cashier',
        roleKeys: ROLE_DEFAULTS.Cashier,
        desiredKeys: [...ROLE_DEFAULTS.Cashier, 'invoice.cancel'],
      }),
    ).not.toThrow();
  });

  it('deny override is allowed when actor holds the key', () => {
    const cashierKeys = [...ROLE_DEFAULTS.Cashier];
    const withoutPrint = cashierKeys.filter((k) => k !== 'invoice.print');
    expect(() =>
      assertCanSetEffectivePermissions({
        actor: manager(['user.change_role']),
        targetUserId: 'csh-2',
        targetRoleName: 'Cashier',
        roleKeys: cashierKeys,
        desiredKeys: withoutPrint,
      }),
    ).not.toThrow();
  });

  it('Cashier cannot administer Warehouse (peer rank)', () => {
    expectDenied(
      () =>
        assertCanSetEffectivePermissions({
          actor: cashier(['user.change_role']),
          targetUserId: 'wh-2',
          targetRoleName: 'Warehouse',
          roleKeys: ROLE_DEFAULTS.Warehouse,
          desiredKeys: ROLE_DEFAULTS.Warehouse,
        }),
      'hierarchy',
    );
  });

  it('Warehouse cannot grant analytics.view they do not possess to a lower custom role', () => {
    expectDenied(
      () =>
        assertCanSetEffectivePermissions({
          actor: warehouse(['user.change_role']),
          targetUserId: 'intern-1',
          targetRoleName: 'Intern',
          roleKeys: ['product.view'],
          desiredKeys: ['product.view', 'analytics.view'],
        }),
      'delegation',
    );
  });
});

describe('AUTHZ role permission assignment', () => {
  it('Manager with user.change_role cannot assign admin-exclusive keys to a role', () => {
    expectDenied(
      () =>
        assertCanAssignPermissionKeys({
          actor: manager(['user.change_role']),
          permissionKeys: ['backup.restore', 'invoice.view'],
        }),
      'delegation',
    );
  });

  it('Manager cannot assign permissions they do not hold', () => {
    expectDenied(
      () =>
        assertCanAssignPermissionKeys({
          actor: manager(['user.change_role']),
          permissionKeys: ['finance.close_period'],
        }),
      'delegation',
    );
  });

  it('Admin may assign admin-exclusive keys to a role', () => {
    expect(() =>
      assertCanAssignPermissionKeys({
        actor: admin(),
        permissionKeys: [...ADMIN_EXCLUSIVE_PERMISSIONS, 'invoice.view'],
      }),
    ).not.toThrow();
  });
});
