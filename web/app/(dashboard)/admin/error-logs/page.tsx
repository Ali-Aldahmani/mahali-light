'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import RequirePermission from '@/components/guards/RequirePermission';
import ReportExportBar from '@/components/reports/ReportExportBar';
import {
  listErrorLogs,
  resolveErrorLog,
  cleanupErrorLogs,
} from '@/services/errorLogService';
import { formatDateTime, storeDate } from '@/lib/utils/format';
import { toast } from '@/store/toastStore';
import Select from '@/components/ui/Select';
import Skeleton from '@/components/ui/skeleton';
import Pagination from '@/components/ui/pagination/Pagination';

const SEV_TONE: Record<string, string> = {
  critical: 'error',
  error: 'error',
  warning: 'warning',
  info: 'muted',
};

// The server caps a page at 50 rows and defaults to 5.
const PAGE_SIZES = [5, 25, 50];

function ErrorLogsAdminPageInner() {
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [escalations, setEscalations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('');
  const [resolved, setResolved] = useState('false');
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listErrorLogs({
        severity: severity || undefined,
        resolved,
        limit: pageSize,
        page,
      });
      const nextTotal = Number(res.meta?.pagination?.total) || 0;
      const lastPage = Math.max(1, Math.ceil(nextTotal / pageSize));
      // Resolving or cleaning up the last rows of the last page leaves it
      // empty: step back to the new last page instead of showing nothing.
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(res.data || []);
      setTotal(nextTotal);
      setSummary(res.meta?.summary);
      setEscalations(res.meta?.escalations || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [severity, resolved, pageSize, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const resolve = async (id: string) => {
    const note = window.prompt('Resolution note (optional):');
    try {
      await resolveErrorLog(id, note || '');
      toast.success('Error marked resolved.');
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const cleanup = async () => {
    if (!window.confirm('Delete resolved logs older than 90 days?')) return;
    try {
      const r = await cleanupErrorLogs(90);
      toast.success(`Deleted ${r.deleted} log(s).`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Error logs"
        subtitle="Append-only server error trail with auto-escalation."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="secondary" onClick={cleanup}>
              Cleanup 90d
            </Button>
            <ReportExportBar
              type="error_logs"
              params={{
                start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                  .toISOString()
                  .slice(0, 10),
                end_date: storeDate(),
                severity: severity || undefined,
                resolved: resolved || undefined,
              }}
            />
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
        <Select
          containerClassName="w-44"
          value={severity}
          onChange={(v) => {
            setSeverity(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All severities' },
            { value: 'critical', label: 'Critical' },
            { value: 'error', label: 'Error' },
            { value: 'warning', label: 'Warning' },
            { value: 'info', label: 'Info' },
          ]}
        />
        <Select
          containerClassName="w-40"
          value={resolved}
          onChange={(v) => {
            setResolved(v);
            setPage(1);
          }}
          options={[
            { value: 'false', label: 'Unresolved' },
            { value: 'true', label: 'Resolved' },
            { value: '', label: 'All' },
          ]}
        />
        <Select
          containerClassName="w-36"
          value={pageSize}
          onChange={(v) => {
            setPageSize(Number(v));
            setPage(1);
          }}
          options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} per page` }))}
        />
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
                <td colSpan={6} className="px-3 py-4">
                  <Skeleton lines={5} label="Loading error logs" />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                  No error logs match these filters.
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

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={(p) => setPage(Math.min(Math.max(1, p), pageCount))}
            label="Error log pages"
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === 'error' ? 'text-error' : 'text-ink'}`}>
        {value ?? 0}
      </p>
    </div>
  );
}

export default function ErrorLogsAdminPage() {
  return (
    <RequirePermission permission="errors.view_all">
      <ErrorLogsAdminPageInner />
    </RequirePermission>
  );
}
