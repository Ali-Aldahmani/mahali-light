import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import RoleFormSlideOver from './RoleFormSlideOver.jsx';
import { deleteRole, listRoles } from '../../services/roleService.js';
import { toast } from '../../store/toastStore.js';

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [confirmDel, setConfirmDel] = useState(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRoles();
      setRoles(data || []);
    } catch (err) {
      toast.error(err?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  async function confirmDelete() {
    if (!confirmDel) return;
    setDelLoading(true);
    try {
      await deleteRole(confirmDel.id);
      toast.success(`Role ${confirmDel.name} deleted.`);
      setConfirmDel(null);
      fetch();
    } catch (err) {
      if (err?.code === 'RESOURCE_IN_USE') {
        toast.error('This role is still assigned to users. Reassign them first.');
      } else if (err?.code === 'ROLE_IS_SYSTEM') {
        toast.error('System roles cannot be deleted.');
      } else {
        toast.error(err?.message || 'Could not delete role.');
      }
    } finally {
      setDelLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define who can do what across the system."
        action={
          <PermissionGate permission="user.change_role">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add Role
            </Button>
          </PermissionGate>
        }
      />

      {loading ? (
        <div className="card p-16 flex items-center justify-center">
          <Spinner size="lg" className="text-accent" />
        </div>
      ) : roles.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={20} />}
          title="No roles yet"
          description="Create a role and assign permissions to it."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {roles.map((role) => (
            <div
              key={role.id}
              className="card p-5 flex flex-col"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-ink truncate">
                      {role.name}
                    </h3>
                    {role.isSystem && (
                      <span title="System role" className="text-ink-muted">
                        <Lock size={14} />
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted line-clamp-2">
                    {role.description || 'No description provided.'}
                  </p>
                </div>
                <Badge tone="accent">
                  {role.permissionKeys?.length || 0} perms
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {(role.modules || []).slice(0, 8).map((m) => (
                  <Badge key={m} tone="muted" size="sm">
                    {m}
                  </Badge>
                ))}
                {(role.modules || []).length > 8 && (
                  <Badge tone="muted" size="sm">
                    +{role.modules.length - 8}
                  </Badge>
                )}
                {(role.modules || []).length === 0 && (
                  <span className="text-xs text-ink-muted">No permissions yet</span>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between text-xs text-ink-muted">
                <span>{role.userCount} active user(s)</span>
              </div>

              <div className="mt-4 pt-4 border-t border-border flex items-center justify-end gap-2">
                <PermissionGate permission="user.change_role">
                  <Link to={`/roles/${role.id}/permissions`}>
                    <Button variant="secondary" size="sm" leftIcon={<ShieldCheck size={14} />}>
                      Permissions
                    </Button>
                  </Link>
                </PermissionGate>
                <PermissionGate permission="user.change_role">
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Pencil size={14} />}
                    onClick={() => {
                      setEditing(role);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                </PermissionGate>
                <PermissionGate permission="user.change_role">
                  {!role.isSystem && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={14} />}
                      className="text-error hover:bg-error-light"
                      onClick={() => setConfirmDel(role)}
                    >
                      Delete
                    </Button>
                  )}
                </PermissionGate>
              </div>
            </div>
          ))}
        </div>
      )}

      <RoleFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialValue={editing}
        onSaved={fetch}
      />

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`Delete ${confirmDel?.name}?`}
        description="This action cannot be undone. Users currently assigned to this role must be reassigned first."
        confirmLabel="Delete role"
        variant="danger"
        onConfirm={confirmDelete}
        loading={delLoading}
      />
    </div>
  );
}
