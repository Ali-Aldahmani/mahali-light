import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Search, Shield, ShieldPlus } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { getUserPermissions, setUserPermissions } from '../../services/userService.js';
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
  notification: 'Notifications',
};

export default function UserPermissionsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const result = await getUserPermissions(id);
        if (cancelled) return;
        setData(result);
        setSelected(new Set(result.effectiveKeys));
      } catch (err) {
        toast.error(err?.message || 'Failed to load user permissions');
        navigate('/team?tab=users', { replace: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const roleKeys = useMemo(
    () => new Set(data?.rolePermissionKeys || []),
    [data],
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    const filter = query.trim().toLowerCase();
    for (const p of data.allPermissions) {
      if (filter) {
        if (
          !p.key.toLowerCase().includes(filter) &&
          !p.label.toLowerCase().includes(filter) &&
          !p.module.toLowerCase().includes(filter)
        ) continue;
      }
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module).push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      (MODULE_LABELS[a] || a).localeCompare(MODULE_LABELS[b] || b),
    );
  }, [data, query]);

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
    const allChecked = allKeys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of allKeys) {
        if (allChecked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  async function onSave() {
    setSaving(true);
    try {
      await setUserPermissions(id, Array.from(selected));
      toast.success(`Permissions for ${data.username} saved.`);
      navigate('/team?tab=users');
    } catch (err) {
      toast.error(err?.message || 'Could not save permissions.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="card p-16 flex items-center justify-center">
        <Spinner size="lg" className="text-accent" />
      </div>
    );
  }

  const totalPermissions = data.allPermissions.length;
  const selectedCount = selected.size;

  // Counts of overrides vs role baseline
  const extraGrants = Array.from(selected).filter((k) => !roleKeys.has(k)).length;
  const deniedFromRole = Array.from(roleKeys).filter((k) => !selected.has(k)).length;

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Shield size={18} className="text-accent" />
            {data.username}
          </span>
        }
        subtitle={
          <span className="inline-flex items-center gap-2">
            Permissions for this user.
            <Badge tone="neutral" size="sm">{data.roleName} role</Badge>
            {extraGrants > 0 && (
              <Badge tone="success" size="sm">+{extraGrants} extra</Badge>
            )}
            {deniedFromRole > 0 && (
              <Badge tone="error" size="sm">−{deniedFromRole} denied</Badge>
            )}
          </span>
        }
        action={
          <>
            <Button
              variant="secondary"
              leftIcon={<ArrowLeft size={16} />}
              onClick={() => navigate('/team?tab=users')}
            >
              Back
            </Button>
            <Button onClick={onSave} loading={saving} leftIcon={<Save size={16} />}>
              Save changes
            </Button>
          </>
        }
      />

      {/* Legend */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-accent-light border border-accent/40 inline-block" />
          From role
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldPlus size={12} className="text-success" />
          Extra grant (not in role)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-error-light border border-error/40 inline-block" />
          Denied (role has it, user doesn't)
        </span>
      </div>

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
          {totalPermissions} effective
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
                  const fromRole = roleKeys.has(p.key);
                  // Highlight: denied = fromRole + not checked; extra = checked + not fromRole
                  const isDenied = fromRole && !checked;
                  const isExtra  = !fromRole && checked;
                  return (
                    <label
                      key={p.key}
                      className={cn(
                        'flex items-start gap-3 px-5 py-3 cursor-pointer',
                        fromRole && checked && 'bg-accent-light/20 hover:bg-accent-light/30',
                        isDenied && 'bg-error-light/20 hover:bg-error-light/30',
                        isExtra && 'bg-success-light/20 hover:bg-success-light/30',
                        !fromRole && !checked && 'hover:bg-surface-2/60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.key)}
                        className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink">{p.label}</p>
                          {fromRole && (
                            <Badge tone="accent" size="sm">role</Badge>
                          )}
                          {isExtra && (
                            <Badge tone="success" size="sm">extra</Badge>
                          )}
                          {isDenied && (
                            <Badge tone="error" size="sm">denied</Badge>
                          )}
                        </div>
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
        <Button variant="secondary" onClick={() => navigate('/team?tab=users')}>
          Cancel
        </Button>
        <Button onClick={onSave} loading={saving} leftIcon={<Save size={16} />}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
