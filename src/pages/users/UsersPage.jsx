import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Pencil, Plus, Search, UserCog, UserX } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Table from '../../components/ui/Table.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { OnlineBadge, RoleBadge, StatusBadge } from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import UserFormSlideOver from './UserFormSlideOver.jsx';
import { deactivateUser, forceLogout, listUsers } from '../../services/userService.js';
import { listRoles } from '../../services/roleService.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import { timeAgo } from '../../utils/format.js';

export default function UsersPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [roles, setRoles] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [confirm, setConfirm] = useState(null); // { type, user }
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, meta: m } = await listUsers({
        page,
        limit: 20,
        search,
      });
      setUsers(data || []);
      setMeta(m || { page: 1, limit: 20, total: 0 });
    } catch (err) {
      toast.error(err?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    listRoles()
      .then((data) => setRoles(data || []))
      .catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => setPage(1), 250);
    return () => clearTimeout(id);
  }, [search]);

  const columns = useMemo(
    () => [
      {
        key: 'user',
        header: 'User',
        sortable: false,
        render: (row) => (
          <div className="flex items-center gap-3">
            <Avatar
              name={row.employee?.name || row.username}
              size="sm"
              online={row.isOnline}
            />
            <div className="min-w-0">
              <p className="font-medium text-ink truncate">
                {row.employee?.name || row.username}
              </p>
              <p className="text-xs text-ink-muted truncate">@{row.username}</p>
            </div>
          </div>
        ),
        accessor: (r) => r.employee?.name || r.username,
      },
      {
        key: 'role',
        header: 'Role',
        render: (row) => <RoleBadge role={row.role?.name} />,
        accessor: (r) => r.role?.name,
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge active={row.isActive} />,
        accessor: (r) => (r.isActive ? 'active' : 'inactive'),
      },
      {
        key: 'presence',
        header: 'Presence',
        sortable: false,
        render: (row) => (
          <div>
            <OnlineBadge online={row.isOnline} />
            {row.lastActiveAt && (
              <p className="text-[11px] text-ink-muted mt-0.5">
                Active {timeAgo(row.lastActiveAt)}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right',
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            <PermissionGate permission="user.edit">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Pencil size={14} />}
                onClick={() => {
                  setEditing(row);
                  setFormOpen(true);
                }}
              >
                Edit
              </Button>
            </PermissionGate>
            <PermissionGate permission="user.force_logout">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LogOut size={14} />}
                disabled={!row.isOnline || row.id === currentUserId}
                onClick={() => setConfirm({ type: 'force_logout', user: row })}
              >
                Force logout
              </Button>
            </PermissionGate>
            <PermissionGate permission="user.edit">
              {row.isActive && row.id !== currentUserId && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<UserX size={14} />}
                  onClick={() => setConfirm({ type: 'deactivate', user: row })}
                  className="text-error hover:bg-error-light"
                >
                  Deactivate
                </Button>
              )}
            </PermissionGate>
          </div>
        ),
      },
    ],
    [currentUserId],
  );

  async function runConfirm() {
    if (!confirm) return;
    setActionLoading(true);
    try {
      if (confirm.type === 'deactivate') {
        await deactivateUser(confirm.user.id);
        toast.success(`Deactivated ${confirm.user.username}.`);
      } else if (confirm.type === 'force_logout') {
        const res = await forceLogout(confirm.user.id);
        toast.success(
          `Closed ${res?.sessionsClosed || 0} session(s) for ${confirm.user.username}.`,
        );
      }
      setConfirm(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.message || 'Action failed.');
    } finally {
      setActionLoading(false);
    }
  }

  const isEmpty = !loading && users.length === 0 && !search;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Login accounts and their roles."
        action={
          <PermissionGate permission="user.create">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add User
            </Button>
          </PermissionGate>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Input
          placeholder="Search by username or employee name…"
          leftIcon={<Search size={14} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="max-w-sm flex-1"
        />
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<UserCog size={20} />}
          title="No users yet"
          description="Create the first login account to grant POS access."
          action={
            <PermissionGate permission="user.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add User
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={users}
          loading={loading}
          empty="No users match your search."
          pagination={{
            page: meta.page,
            pageSize: meta.limit,
            total: meta.total,
            onPageChange: (p) => setPage(p),
          }}
        />
      )}

      <UserFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialValue={editing}
        roles={roles}
        onSaved={fetchUsers}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={
          confirm?.type === 'force_logout'
            ? `Force logout ${confirm?.user?.username}?`
            : `Deactivate ${confirm?.user?.username}?`
        }
        description={
          confirm?.type === 'force_logout'
            ? 'All of this user’s active sessions will be ended immediately.'
            : 'This user will be unable to sign in. You can reactivate them later by editing their account.'
        }
        confirmLabel={confirm?.type === 'force_logout' ? 'Force logout' : 'Deactivate'}
        variant={confirm?.type === 'deactivate' ? 'danger' : 'primary'}
        onConfirm={runConfirm}
        loading={actionLoading}
      />
    </div>
  );
}
