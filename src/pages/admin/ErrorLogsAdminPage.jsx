import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {
  listErrorLogs,
  resolveErrorLog,
  cleanupErrorLogs,
} from '../../services/errorLogService.js';
import { formatDateTime } from '../../utils/format.js';
import { toast } from '../../store/toastStore.js';

const SEV_TONE = {
  critical: 'error',
  error: 'error',
  warning: 'warning',
  info: 'muted',
};

export default function ErrorLogsAdminPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [escalations, setEscalations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('');
  const [resolved, setResolved] = useState('false');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listErrorLogs({
        severity: severity || undefined,
        resolved,
        limit: 80,
      });
      setRows(res.data || []);
      setSummary(res.meta?.summary);
      setEscalations(res.meta?.escalations || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [severity, resolved]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id) => {
    const note = window.prompt('Resolution note (optional):');
    try {
      await resolveErrorLog(id, note || '');
      toast.success('Error marked resolved.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cleanup = async () => {
    if (!window.confirm('Delete resolved logs older than 90 days?')) return;
    try {
      const r = await cleanupErrorLogs(90);
      toast.success(`Deleted ${r.deleted} log(s).`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Error logs"
        subtitle="Append-only server error trail with auto-escalation."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="secondary" onClick={cleanup}>
              Cleanup 90d
            </Button>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Critical (7d)" value={summary.critical_7d} tone="error" />
          <Stat label="Error (7d)" value={summary.error_7d} />
          <Stat label="Warning (7d)" value={summary.warning_7d} />
          <Stat label="Unresolved" value={summary.unresolved} tone="warning" />
          <Stat label="Last hour" value={summary.last_hour} />
        </div>
      )}

      {escalations.length > 0 && (
        <div className="space-y-2">
          {escalations.map((e) => (
            <div
              key={e.code}
              className="flex items-center gap-3 rounded-card border border-warning bg-warning-light/40 px-4 py-3 text-sm"
            >
              <AlertTriangle size={18} className="text-warning" />
              <div>
                <p className="font-semibold text-ink">
                  Auto-escalated: {e.code} × {e.count} in 1 hour
                </p>
                <p className="text-xs text-ink-muted">
                  PCs: {(e.pcs || []).filter(Boolean).join(', ') || '—'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-input border border-border px-2 py-1 text-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select
          className="rounded-input border border-border px-2 py-1 text-sm"
          value={resolved}
          onChange={(e) => setResolved(e.target.value)}
        >
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Message</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2 text-left">User / PC</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2 max-w-md truncate" title={r.message}>
                    {r.message}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge tone={SEV_TONE[r.severity] || 'neutral'}>{r.severity}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {r.user_username || '—'}
                    <br />
                    {r.pc_identifier || '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!r.resolved && (
                      <Button size="sm" variant="ghost" onClick={() => resolve(r.id)}>
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === 'error' ? 'text-error' : 'text-ink'}`}>
        {value ?? 0}
      </p>
    </div>
  );
}
