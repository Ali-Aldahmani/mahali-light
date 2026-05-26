import { useAuthStore } from '../../store/authStore.js';

// Hides its children unless the current user has at least one of `permissions`.
// Usage:
//   <PermissionGate permission="user.create">...</PermissionGate>
//   <PermissionGate permissions={['user.create','user.edit']}>...</PermissionGate>
export default function PermissionGate({
  permission,
  permissions,
  fallback = null,
  children,
}) {
  const owned = useAuthStore((s) => s.permissions);
  const set = new Set(owned || []);
  const required = permissions || (permission ? [permission] : []);

  if (required.length === 0) return children;
  const ok = required.some((p) => set.has(p));
  if (!ok) return fallback;
  return children;
}
