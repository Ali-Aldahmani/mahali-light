import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Edit, Lock } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import { cn } from '../../utils/cn.js';
import { useAuthStore } from '../../store/authStore.js';
import {
  listAccounts,
  createAccount,
  deleteAccount,
} from '../../services/financeService.js';
import { toast } from '../../store/toastStore.js';

const TYPE_TONE = {
  asset: 'bg-accent-light text-accent',
  liability: 'bg-warning-light text-warning',
  equity: 'bg-surface-2 text-ink-muted',
  revenue: 'bg-success-light text-success',
  expense: 'bg-error-light text-error',
};

function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  roots.sort((a, b) => a.code.localeCompare(b.code));
  for (const n of byId.values()) n.children.sort((a, b) => a.code.localeCompare(b.code));
  return roots;
}

export default function AccountsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission('finance.close_period');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [parentForNew, setParentForNew] = useState(null);

  const tree = useMemo(() => buildTree(rows), [rows]);

  function refresh() {
    setLoading(true);
    listAccounts()
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(err?.message || 'Failed to load accounts.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(account) {
    if (!confirm(`Delete account ${account.code} ${account.name}?`)) return;
    try {
      await deleteAccount(account.id);
      toast.success('Account deleted.');
      refresh();
    } catch (err) {
      toast.error(err?.message || 'Could not delete account.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chart of accounts"
        subtitle="System accounts are locked; custom accounts can be added freely."
        action={
          canManage && (
            <Button
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setParentForNew(null);
                setShowForm(true);
              }}
            >
              Add account
            </Button>
          )
        }
      />

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load accounts" description={error} />
      )}
      {!loading && !error && (
        <div className="rounded-card border border-border bg-surface overflow-hidden">
          <ul>
            {tree.map((root) => (
              <AccountNode
                key={root.id}
                account={root}
                depth={0}
                canManage={canManage}
                onAddSub={(parent) => {
                  setParentForNew(parent);
                  setShowForm(true);
                }}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </div>
      )}

      <NewAccountSlideOver
        open={showForm}
        parent={parentForNew}
        onClose={() => setShowForm(false)}
        onCreated={() => {
          setShowForm(false);
          refresh();
        }}
      />
    </div>
  );
}

function AccountNode({ account, depth, canManage, onAddSub, onDelete }) {
  return (
    <>
      <li
        className={cn(
          'flex items-center gap-3 border-b border-border last:border-b-0 px-3 py-2',
        )}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        <span className="font-mono text-xs text-ink-muted w-12">{account.code}</span>
        <span className="text-sm font-medium text-ink">{account.name}</span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
            TYPE_TONE[account.type],
          )}
        >
          {account.type}
        </span>
        {account.isSystem && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
            <Lock className="h-3 w-3" /> System
          </span>
        )}
        {canManage && (
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAddSub(account)}
            >
              Add sub
            </Button>
            {!account.isSystem && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(account)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </li>
      {account.children.map((c) => (
        <AccountNode
          key={c.id}
          account={c}
          depth={depth + 1}
          canManage={canManage}
          onAddSub={onAddSub}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function NewAccountSlideOver({ open, parent, onClose, onCreated }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setName('');
      setType(parent?.type || 'expense');
      setDescription('');
    }
  }, [open, parent]);

  async function submit() {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required.');
      return;
    }
    setSubmitting(true);
    try {
      await createAccount({
        code: code.trim(),
        name: name.trim(),
        type,
        parentId: parent?.id || null,
        description: description.trim() || undefined,
      });
      toast.success('Account added.');
      onCreated?.();
    } catch (err) {
      toast.error(err?.message || 'Could not add account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={parent ? `Add under ${parent.name}` : 'Add account'}
      subtitle={parent ? `Parent: ${parent.code} ${parent.name}` : null}
      footer={
        <div className="flex justify-end gap-2 w-full">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            Create account
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">Code</label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 5015" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm"
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink-muted">
            Description
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
    </SlideOver>
  );
}
