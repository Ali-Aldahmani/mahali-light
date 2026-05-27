import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {
  listBugReports,
  getBugReport,
  updateBugReport,
  addBugComment,
} from '../../services/bugReportService.js';
import { API_BASE } from '../../config.js';
import { formatDateTime, timeAgo } from '../../utils/format.js';
import { toast } from '../../store/toastStore.js';

const URGENCY_TONE = { blocking: 'error', major: 'warning', minor: 'success' };
const STATUS_TONE = {
  open: 'error',
  in_progress: 'accent',
  resolved: 'success',
  wont_fix: 'muted',
};

function filesUrl(rel) {
  if (!rel) return null;
  const base = API_BASE.replace(/\/api$/, '');
  return `${base}/files/${rel}`;
}

export default function BugReportsAdminPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBugReports({
        status: statusFilter || undefined,
        limit: 50,
      });
      setRows(res.data || []);
      setSummary(res.meta?.summary);
    } catch (err) {
      toast.error(err.message || 'Could not load bug reports.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id) => {
    setSelectedId(id);
    try {
      const d = await getBugReport(id);
      setDetail(d);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const patchStatus = async (status) => {
    if (!selectedId) return;
    try {
      await updateBugReport(selectedId, { status });
      toast.success(`Marked ${status.replace('_', ' ')}.`);
      await openDetail(selectedId);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitComment = async () => {
    if (!comment.trim() || !selectedId) return;
    try {
      await addBugComment(selectedId, comment.trim());
      setComment('');
      await openDetail(selectedId);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bug reports"
        subtitle="User-submitted issues with screenshots and breadcrumbs."
        action={
          <Button variant="secondary" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </Button>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard label="Open" value={summary.open_count} alert={summary.blocking_open > 0} />
          <SummaryCard label="In progress" value={summary.in_progress_count} />
          <SummaryCard label="Resolved this month" value={summary.resolved_month} />
          <SummaryCard label="Blocking open" value={summary.blocking_open} alert />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {['', 'open', 'in_progress', 'resolved', 'wont_fix'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              statusFilter === s ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted'
            }`}
          >
            {s ? s.replace('_', ' ') : 'All'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="card overflow-hidden xl:col-span-1">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left">Ticket</th>
                <th className="px-3 py-2 text-left">Urgency</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-ink-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-center text-ink-muted">
                    No bug reports.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer border-t border-border hover:bg-surface-2/60 ${
                    selectedId === r.id ? 'bg-accent-light/40' : ''
                  }`}
                  onClick={() => openDetail(r.id)}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink">{r.ticket_number}</p>
                    <p className="text-xs text-ink-muted">{timeAgo(r.created_at)}</p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={URGENCY_TONE[r.urgency] || 'neutral'}>{r.urgency}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5 xl:col-span-2">
          {!detail ? (
            <p className="text-sm text-ink-muted">Select a report to view details.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{detail.ticket_number}</h2>
                  <p className="text-xs text-ink-muted">
                    {detail.reported_by_username} · {detail.pc_identifier} ·{' '}
                    {formatDateTime(detail.created_at)}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[detail.status] || 'neutral'}>{detail.status}</Badge>
              </div>
              <section>
                <h3 className="text-xs font-semibold uppercase text-ink-muted">Context</h3>
                <p className="mt-1 text-sm">{detail.what_were_you_doing}</p>
                <p className="mt-2 text-sm text-ink-muted">{detail.what_happened}</p>
              </section>
              {detail.screenshot_path && (
                <a href={filesUrl(detail.screenshot_path)} target="_blank" rel="noreferrer">
                  <img
                    src={filesUrl(detail.screenshot_path)}
                    alt="Screenshot"
                    className="max-h-64 rounded border border-border"
                  />
                </a>
              )}
              {detail.breadcrumbs?.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase text-ink-muted">Breadcrumbs</h3>
                  <ol className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-ink-muted">
                    {detail.breadcrumbs.map((b, i) => (
                      <li key={i}>
                        {b.at} — {b.action} @ {b.screen}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => patchStatus('in_progress')}>
                  In progress
                </Button>
                <Button size="sm" onClick={() => patchStatus('resolved')}>
                  Resolve
                </Button>
                <Button size="sm" variant="danger" onClick={() => patchStatus('wont_fix')}>
                  Won&apos;t fix
                </Button>
              </div>
              <div>
                <textarea
                  className="w-full rounded-input border border-border p-2 text-sm"
                  rows={2}
                  placeholder="Add admin comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <Button size="sm" className="mt-2" onClick={submitComment}>
                  Add comment
                </Button>
              </div>
              {detail.comments?.length > 0 && (
                <ul className="space-y-2 border-t border-border pt-3 text-sm">
                  {detail.comments.map((c) => (
                    <li key={c.id} className="rounded bg-surface-2/50 p-2">
                      <span className="font-medium">{c.author_username}</span>
                      <span className="text-xs text-ink-muted"> · {timeAgo(c.created_at)}</span>
                      <p className="mt-1">{c.comment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, alert }) {
  return (
    <div
      className={`rounded-card border p-4 ${
        alert && Number(value) > 0 ? 'border-error bg-error-light/30' : 'border-border bg-surface'
      }`}
    >
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value ?? 0}</p>
    </div>
  );
}
