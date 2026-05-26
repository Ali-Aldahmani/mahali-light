import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, Save, Search } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {
  getRole,
  listAllPermissions,
  setRolePermissions,
} from '../../services/roleService.js';
import { toast } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

const MODULE_LABELS = {
  invoice: 'Invoices',
  product: 'Products',
  supplier: 'Suppliers',
  customer: 'Customers',
  employee: 'Employees',
  user: 'Users',
  stock: 'Stock',
  cash: 'Cash Drawer',
  bank: 'Bank',
  return: 'Returns',
  attendance: 'Attendance',
  bills: 'Bills',
  finance: 'Finance',
  report: 'Reports',
  analytics: 'Analytics',
  backup: 'Backup',
  settings: 'Settings',
  errors: 'Error Logs',
  bug: 'Bug Reports',
  warranty: 'Warranty',
};

export default function RolePermissionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const [roleData, perms] = await Promise.all([getRole(id), listAllPermissions()]);
        if (cancelled) return;
        setRole(roleData);
        setPermissions(perms || []);
        setSelected(new Set(roleData?.permissionKeys || []));
      } catch (err) {
        toast.error(err?.message || 'Failed to load role');
        navigate('/roles', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const groups = useMemo(() => {
    const map = new Map();
    const filter = query.trim().toLowerCase();
    for (const p of permissions) {
      if (filter) {
        if (
          !p.key.toLowerCase().includes(filter) &&
          !p.label.toLowerCase().includes(filter) &&
          !p.module.toLowerCase().includes(filter)
        ) {
          continue;
        }
      }
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module).push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      (MODULE_LABELS[a] || a).localeCompare(MODULE_LABELS[b] || b),
    );
  }, [permissions, query]);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleModule(modPerms) {
    const allKeys = modPerms.map((p) => p.key);
    const allSelected = allKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of allKeys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  async function onSave() {
    setSaving(true);
    try {
      await setRolePermissions(id, Array.from(selected));
      toast.success(`Permissions for ${role.name} updated.`);
      navigate('/roles');
    } catch (err) {
      toast.error(err?.message || 'Could not save permissions.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !role) {
    return (
      <div className="card p-16 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  const totalPermissions = permissions.length;
  const selectedCount = selected.size;

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {role.name}
            {role.isSystem && (
              <span title="System role" className="text-ink-muted">
                <Lock size={16} />
              </span>
            )}
          </span>
        }
        subtitle={role.description || 'Toggle permissions for this role.'}
        action={
          <>
            <Link to="/roles">
              <Button variant="secondary" leftIcon={<ArrowLeft size={16} />}>
                Back
              </Button>
            </Link>
            <Button onClick={onSave} loading={saving} leftIcon={<Save size={16} />}>
              Save changes
            </Button>
          </>
        }
      />

      <div className="card p-4 mb-4 flex items-center justify-between gap-4">
        <Input
          placeholder="Search permissions…"
          leftIcon={<Search size={14} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          containerClassName="max-w-md flex-1"
        />
        <div className="text-sm text-ink-muted">
          <span className="font-medium text-ink">{selectedCount}</span> /{' '}
          {totalPermissions} permissions selected
        </div>
      </div>

      <div className="space-y-4">
        {groups.length === 0 && (
          <div className="card p-10 text-center text-sm text-ink-muted">
            No permissions match your search.
          </div>
        )}

        {groups.map(([module, perms]) => {
          const allKeys = perms.map((p) => p.key);
          const allSelected = allKeys.every((k) => selected.has(k));
          const someSelected = allKeys.some((k) => selected.has(k));
          return (
            <section key={module} className="card overflow-hidden">
              <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-ink">
                    {MODULE_LABELS[module] || module}
                  </h3>
                  <Badge
                    tone={allSelected ? 'success' : someSelected ? 'warning' : 'muted'}
                    size="sm"
                  >
                    {perms.filter((p) => selected.has(p.key)).length} / {perms.length}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => toggleModule(perms)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              </header>
              <div className="divide-y divide-border">
                {perms.map((p) => {
                  const checked = selected.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={cn(
                        'flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-surface-2/60',
                        checked && 'bg-accent-light/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.key)}
                        className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{p.label}</p>
                        <p className="text-xs text-ink-muted font-mono">{p.key}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Link to="/roles">
          <Button variant="secondary">Cancel</Button>
        </Link>
        <Button onClick={onSave} loading={saving} leftIcon={<Save size={16} />}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
