import { useEffect, useState } from 'react';
import { Lock, Unlock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { cn } from '../../utils/cn.js';
import { formatDate } from '../../utils/format.js';
import {
  listPeriods,
  closePeriod,
  getPeriodChecklist,
} from '../../services/financeService.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';

const TYPE_TONE = {
  monthly: 'bg-accent-light text-accent',
  quarterly: 'bg-warning-light text-warning',
  yearly: 'bg-success-light text-success',
};

export default function PeriodsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canClose = hasPermission('finance.close_period');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(null); // { period, checklist }

  function refresh() {
    setLoading(true);
    listPeriods()
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(err?.message || 'Failed to load periods.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function startClose(period) {
    try {
      const checklist = await getPeriodChecklist(period.id);
      setClosing({ period, checklist: checklist.checklist || [] });
    } catch (err) {
      toast.error(err?.message || 'Could not load period checklist.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financial periods"
        subtitle="Closed periods lock all journal entries and source transactions."
      />

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      {error && !loading && (
        <EmptyState title="Could not load periods" description={error} />
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="No periods yet"
          description="Run database migrations to seed the standard 2026 periods."
        />
      )}
      {!loading && rows.length > 0 && (
        <div className="rounded-card border border-border bg-surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                <th className="text-left py-2 px-3">Name</th>
                <th className="text-left py-2 px-3">Type</th>
                <th className="text-left py-2 px-3">Start</th>
                <th className="text-left py-2 px-3">End</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-b-0">
                  <td className="py-2 px-3 text-sm">{p.name}</td>
                  <td className="py-2 px-3 text-sm">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                        TYPE_TONE[p.type],
                      )}
                    >
                      {p.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-sm">{formatDate(p.startDate)}</td>
                  <td className="py-2 px-3 text-sm">{formatDate(p.endDate)}</td>
                  <td className="py-2 px-3 text-sm">
                    {p.status === 'open' ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Unlock className="h-3.5 w-3.5" /> Open
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-ink-muted">
                        <Lock className="h-3.5 w-3.5" /> Closed
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {p.status === 'open' && canClose && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => startClose(p)}
                      >
                        Close period
                      </Button>
                    )}
                    {p.status === 'closed' && (
                      <span className="text-xs text-ink-muted">
                        {p.closedByUsername || ''} {p.closedAt ? formatDate(p.closedAt) : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClosePeriodModal
        open={!!closing}
        closing={closing}
        onClose={() => setClosing(null)}
        onClosed={() => {
          setClosing(null);
          refresh();
        }}
      />
    </div>
  );
}

function ClosePeriodModal({ open, closing, onClose, onClosed }) {
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = closing?.checklist?.filter((c) => !c.ok) || [];
  const blocked = pending.length > 0;

  useEffect(() => {
    if (open) setForce(false);
  }, [open]);

  async function submit() {
    if (!closing) return;
    setSubmitting(true);
    try {
      await closePeriod(closing.period.id, { force });
      toast.success(`${closing.period.name} closed.`);
      onClosed?.();
    } catch (err) {
      toast.error(err?.message || 'Could not close period.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!closing) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Close ${closing.period.name}`} size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-light/30 p-3">
          <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-ink">This action cannot be undone</div>
            <div className="text-ink-muted">
              Once closed, no journal entries can be posted to this period and
              no invoices or POs in this period can be edited.
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-muted mb-2">
            Pre-close checklist
          </div>
          <ul className="space-y-1">
            {closing.checklist.map((c) => (
              <li
                key={c.key}
                className={cn(
                  'flex items-center gap-2 text-sm',
                  c.ok ? 'text-ink' : 'text-warning',
                )}
              >
                {c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-warning" />
                )}
                <span className="flex-1">{c.label}</span>
                {!c.ok && (
                  <span className="text-xs">{c.pending} pending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        {blocked && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force close anyway (Admin override)
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={submitting}
            disabled={blocked && !force}
          >
            Confirm close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
