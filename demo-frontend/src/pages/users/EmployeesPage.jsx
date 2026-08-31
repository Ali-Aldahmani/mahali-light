import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, UserMinus, UsersRound } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Table from '../../components/ui/Table.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import EmployeeFormSlideOver from './EmployeeFormSlideOver.jsx';
import {
  deactivateEmployee,
  listEmployees,
} from '../../services/employeeService.js';
import { toast } from '../../store/toastStore.js';
import { formatTime } from '../../utils/format.js';

export default function EmployeesPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [confirmEmp, setConfirmEmp] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, meta: m } = await listEmployees({
        page,
        limit: 20,
        search,
      });
      setRows(data || []);
      setMeta(m || { page: 1, limit: 20, total: 0 });
    } catch (err) {
      toast.error(err?.message || 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    const id = setTimeout(() => setPage(1), 250);
    return () => clearTimeout(id);
  }, [search]);

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Employee',
        render: (row) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.name} size="sm" />
            <div className="min-w-0">
              <p className="font-medium text-ink truncate">{row.name}</p>
              <p className="text-xs text-ink-muted truncate">
                {row.roleTitle || '—'}
              </p>
            </div>
          </div>
        ),
        accessor: (r) => r.name,
      },
      {
        key: 'phone',
        header: 'Phone',
        render: (row) => row.phone || '—',
      },
      {
        key: 'email',
        header: 'Email',
        render: (row) => row.email || '—',
      },
      {
        key: 'shift',
        header: 'Shift',
        sortable: false,
        render: (row) => (
          <span className="font-mono text-xs">
            {formatTime(row.shiftStart)} – {formatTime(row.shiftEnd)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge active={row.isActive} />,
        accessor: (r) => (r.isActive ? 'active' : 'inactive'),
      },
      {
        key: 'actions',
        header: '',
        sortable: false,
        align: 'right',
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            <PermissionGate permission="employee.edit">
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
            <PermissionGate permission="employee.delete">
              {row.isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<UserMinus size={14} />}
                  className="text-error hover:bg-error-light"
                  onClick={() => setConfirmEmp(row)}
                >
                  Deactivate
                </Button>
              )}
            </PermissionGate>
          </div>
        ),
      },
    ],
    [],
  );

  async function confirmDeactivate() {
    if (!confirmEmp) return;
    setConfirmLoading(true);
    try {
      await deactivateEmployee(confirmEmp.id);
      toast.success(`${confirmEmp.name} deactivated.`);
      setConfirmEmp(null);
      fetch();
    } catch (err) {
      toast.error(err?.message || 'Could not deactivate employee.');
    } finally {
      setConfirmLoading(false);
    }
  }

  const isEmpty = !loading && rows.length === 0 && !search;

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Staff records and shift configuration."
        action={
          <PermissionGate permission="employee.create">
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add Employee
            </Button>
          </PermissionGate>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Input
          placeholder="Search by name, phone or email…"
          leftIcon={<Search size={14} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="max-w-sm flex-1"
        />
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<UsersRound size={20} />}
          title="No employees yet"
          description="Add your first employee to start tracking attendance, shifts and login accounts."
          action={
            <PermissionGate permission="employee.create">
              <Button
                leftIcon={<Plus size={16} />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Add Employee
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={loading}
          empty="No employees match your search."
          pagination={{
            page: meta.page,
            pageSize: meta.limit,
            total: meta.total,
            onPageChange: (p) => setPage(p),
          }}
        />
      )}

      <EmployeeFormSlideOver
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialValue={editing}
        onSaved={fetch}
      />

      <ConfirmDialog
        open={!!confirmEmp}
        onClose={() => setConfirmEmp(null)}
        title={`Deactivate ${confirmEmp?.name}?`}
        description="The employee record will be kept for history, but marked inactive."
        confirmLabel="Deactivate"
        variant="danger"
        onConfirm={confirmDeactivate}
        loading={confirmLoading}
      />
    </div>
  );
}
