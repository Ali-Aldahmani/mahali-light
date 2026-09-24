/**
 * Server-side role hierarchy and permission-delegation rules.
 * Used by user create/update and setPermissions. Not a substitute for
 * requirePermission on the route.
 *
 * System ranks (higher may manage strictly lower, unless actor is Admin):
 *   Admin (100) > Manager (50) > Cashier (20) = Warehouse (20)
 * Custom / unknown role names rank below Warehouse.
 */
const { AppError, ERROR_CODES } = require('./errorCodes');

const SYSTEM_ADMIN_ROLE_NAME = 'Admin';

const ROLE_RANK = {
  [SYSTEM_ADMIN_ROLE_NAME]: 100,
  Manager: 50,
  Cashier: 20,
  Warehouse: 20,
};

/** Keys only an Admin role may grant or deny on another user. */
const ADMIN_EXCLUSIVE_PERMISSIONS = [
  'user.create',
  'user.edit',
  'user.change_role',
  'backup.restore',
  'backup.configure',
  'backup.download',
  'settings.edit',
  'finance.close_period',
  'notification.manage',
];

function roleRank(name) {
  if (!name) return 0;
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, name) ? ROLE_RANK[name] : 10;
}

function actorRoleName(actor) {
  return actor?.role || actor?.role_name || null;
}

function isAdminActor(actor) {
  // Anchor admin semantics to the seeded system role — not a custom role that
  // picked a similar display name (creation/rename to reserved names is blocked
  // elsewhere, but this keeps checks correct even if data was tampered with).
  return (
    Boolean(actor?.role_is_system) &&
    actorRoleName(actor) === SYSTEM_ADMIN_ROLE_NAME
  );
}

function actorPermissionSet(actor) {
  return new Set(actor?.permissions || []);
}

function deny(message, details) {
  return new AppError(ERROR_CODES.AUTH_NO_PERMISSION, message, {
    status: 403,
    details: details || null,
  });
}

function assertCanManageTarget({ actor, targetRoleName, targetUserId }) {
  if (targetUserId && actor?.id && String(targetUserId) === String(actor.id)) {
    throw deny('You cannot change your own role or permission overrides.', {
      reason: 'self_modification',
    });
  }
  if (isAdminActor(actor)) return;
  const actorRank = roleRank(actorRoleName(actor));
  const targetRank = roleRank(targetRoleName);
  if (targetRank >= actorRank) {
    throw deny('You cannot administer a user at or above your role.', {
      reason: 'hierarchy',
      actorRole: actorRoleName(actor),
      targetRole: targetRoleName,
    });
  }
}

/**
 * Initial role on POST /users (requires user.create on the route).
 * Cannot assign Admin unless the actor is Admin. Cannot assign a role
 * at or above the actor unless Admin.
 */
function assertCanAssignRole({ actor, newRoleName, newRoleIsSystem = false }) {
  if (!newRoleName) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Role is required.', { status: 400 });
  }
  const isAdminRoleName =
    String(newRoleName).trim().toLowerCase() === SYSTEM_ADMIN_ROLE_NAME.toLowerCase();
  if (isAdminActor(actor)) {
    if (isAdminRoleName && !newRoleIsSystem) {
      throw deny('Only the system Admin role can be assigned.', {
        reason: 'invalid_admin_role',
      });
    }
    return;
  }
  if (isAdminRoleName) {
    throw deny('Only an Admin can assign the Admin role.', {
      reason: 'cannot_assign_admin',
    });
  }
  if (roleRank(newRoleName) >= roleRank(actorRoleName(actor))) {
    throw deny('You cannot assign a role at or above your own.', {
      reason: 'hierarchy',
      actorRole: actorRoleName(actor),
      newRole: newRoleName,
    });
  }
}

/**
 * Changing roleId on PUT /users/:id. Requires user.change_role in addition
 * to user.edit on the route.
 */
function assertCanChangeRole({
  actor,
  targetUserId,
  currentRoleName,
  newRoleName,
  newRoleIsSystem = false,
}) {
  const owned = actorPermissionSet(actor);
  if (!owned.has('user.change_role')) {
    throw deny('Changing a user role requires user.change_role.', {
      missing: ['user.change_role'],
      reason: 'role_change_permission',
    });
  }
  assertCanManageTarget({ actor, targetRoleName: currentRoleName, targetUserId });
  assertCanAssignRole({ actor, newRoleName, newRoleIsSystem });
}

/**
 * Role-level permission assignment (POST /roles, PUT /roles/:id/permissions).
 * Non-admin actors may only grant keys they themselves hold; admin-exclusive
 * keys require an Admin actor.
 */
function assertCanAssignPermissionKeys({ actor, permissionKeys }) {
  if (isAdminActor(actor)) return;
  const owned = actorPermissionSet(actor);
  const exclusive = new Set(ADMIN_EXCLUSIVE_PERMISSIONS);
  const forbidden = [];
  for (const key of permissionKeys || []) {
    if (exclusive.has(key)) forbidden.push(key);
    else if (!owned.has(key)) forbidden.push(key);
  }
  if (forbidden.length) {
    throw deny('You cannot assign permissions outside your authority.', {
      reason: 'delegation',
      forbiddenKeys: forbidden,
    });
  }
}

function assertCanSetEffectivePermissions({
  actor,
  targetUserId,
  targetRoleName,
  roleKeys,
  desiredKeys,
}) {
  assertCanManageTarget({ actor, targetRoleName, targetUserId });

  const owned = actorPermissionSet(actor);
  const admin = isAdminActor(actor);
  const exclusive = new Set(ADMIN_EXCLUSIVE_PERMISSIONS);
  const roleSet = new Set(roleKeys);
  const desired = new Set(desiredKeys);
  const forbiddenGrants = [];
  const forbiddenDenies = [];

  const keys = new Set([...roleSet, ...desired]);
  for (const key of keys) {
    const roleHas = roleSet.has(key);
    const want = desired.has(key);
    if (roleHas === want) continue;

    if (!admin && exclusive.has(key)) {
      if (want && !roleHas) forbiddenGrants.push(key);
      else forbiddenDenies.push(key);
      continue;
    }
    if (!owned.has(key)) {
      if (want && !roleHas) forbiddenGrants.push(key);
      else forbiddenDenies.push(key);
    }
  }

  if (forbiddenGrants.length || forbiddenDenies.length) {
    throw deny('You cannot delegate permissions outside your authority.', {
      reason: 'delegation',
      forbiddenGrants,
      forbiddenDenies,
    });
  }
}

module.exports = {
  SYSTEM_ADMIN_ROLE_NAME,
  ROLE_RANK,
  ADMIN_EXCLUSIVE_PERMISSIONS,
  roleRank,
  isAdminActor,
  assertCanManageTarget,
  assertCanAssignRole,
  assertCanChangeRole,
  assertCanAssignPermissionKeys,
  assertCanSetEffectivePermissions,
};
