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

const ROLE_RANK = {
  Admin: 100,
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
  return actorRoleName(actor) === 'Admin';
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
function assertCanAssignRole({ actor, newRoleName }) {
  if (!newRoleName) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Role is required.', { status: 400 });
  }
  if (isAdminActor(actor)) return;
  if (newRoleName === 'Admin') {
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
function assertCanChangeRole({ actor, targetUserId, currentRoleName, newRoleName }) {
  const owned = actorPermissionSet(actor);
  if (!owned.has('user.change_role')) {
    throw deny('Changing a user role requires user.change_role.', {
      missing: ['user.change_role'],
      reason: 'role_change_permission',
    });
  }
  assertCanManageTarget({ actor, targetRoleName: currentRoleName, targetUserId });
  assertCanAssignRole({ actor, newRoleName });
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
  ROLE_RANK,
  ADMIN_EXCLUSIVE_PERMISSIONS,
  roleRank,
  isAdminActor,
  assertCanManageTarget,
  assertCanAssignRole,
  assertCanChangeRole,
  assertCanSetEffectivePermissions,
};
