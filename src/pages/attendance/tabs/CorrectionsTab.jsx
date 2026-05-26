import { useEffect, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import Select from '../../../components/ui/Select.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import CorrectionRequestCard from '../../../components/ui/CorrectionRequestCard.jsx';
import RequestCorrectionSlideOver from '../../../components/attendance/RequestCorrectionSlideOver.jsx';
import {
  approveCorrection,
  listCorrections,
  rejectCorrection,
} from '../../../services/attendanceService.js';
import { useAuthStore } from '../../../store/authStore.js';
import { toast } from '../../../store/toastStore.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function RejectionPromptModal({ open, onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <ConfirmDialog
      open={open}
      onClose={onCancel}
      onConfirm={() => onConfirm(reason)}
      variant="danger"
      confirmLabel="Reject correction"
      title="Reject correction request"
      loading={busy}
      description={
        <textarea
          className="mt-2 w-full rounded-input border border-border bg-surface p-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (visible to the requester)"
        />
      }
    />
  );
}

export default function CorrectionsTab() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const canApprove = hasPermission('attendance.correction_approve');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [items, setItems] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      if (canApprove) {
        const res = await listCorrections({
          status: statusFilter || undefined,
          limit: 50,
        });
        setItems(res?.data || []);
      }
      if (user?.id) {
        const mine = await listCorrections({
          // attendance.view_all already returns all rows; we filter to mine
          // in the UI for the "My requests" section.
          limit: 50,
        });
        setMyItems(
          (mine?.data || []).filter((c) => c.requestedBy === user.id),
        );
      }
    } catch (err) {
      // If we don't have view_all, listCorrections is forbidden — that's OK,
      // simply show the request button and skip the "all corrections" section.
      if (err.status !== 403) toast.error(err.message || 'Failed to load corrections.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function onApprove(c) {
    setBusy(true);
    try {
      await approveCorrection(c.id);
      toast.success('Correction approved.');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to approve.');
    } finally {
      setBusy(false);
    }
  }

  async function onReject(reason) {
    if (!rejecting) return;
    if (!reason || reason.trim().length < 3) {
      toast.error('Please provide a rejection reason.');
      return;
    }
    setBusy(true);
    try {
      await rejectCorrection(rejecting.id, reason);
      toast.success('Correction rejected.');
      setRejecting(null);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to reject.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Attendance corrections</h2>
          <p className="text-sm text-ink-muted">
            Request a fix for the last 30 days of records.
          </p>
        </div>
        <div className="flex items-end gap-3">
          {canApprove && (
            <Select
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_OPTIONS}
              searchable={false}
              containerClassName="w-40"
            />
          )}
          <Button onClick={() => setOpen(true)}>Request correction</Button>
        </div>
      </div>

      {canApprove && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
            All corrections {statusFilter ? `(${statusFilter})` : ''}
          </h3>
          {loading ? (
            <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
              No correction requests.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((c) => (
                <CorrectionRequestCard
                  key={c.id}
                  correction={c}
                  canReview={canApprove}
                  onApprove={onApprove}
                  onReject={setRejecting}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
          My requests
        </h3>
        {myItems.length === 0 ? (
          <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
            You haven't submitted any corrections yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {myItems.map((c) => (
              <CorrectionRequestCard key={c.id} correction={c} canReview={false} />
            ))}
          </div>
        )}
      </section>

      <RequestCorrectionSlideOver
        open={open}
        onClose={() => setOpen(false)}
        employeeId={user?.employeeId}
        onSaved={refresh}
      />

      <RejectionPromptModal
        open={Boolean(rejecting)}
        onCancel={() => setRejecting(null)}
        onConfirm={onReject}
        busy={busy}
      />
    </div>
  );
}
