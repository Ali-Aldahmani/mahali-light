import { useEffect, useState } from 'react';
import Button from '../../../components/ui/Button.jsx';
import Select from '../../../components/ui/Select.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import LeaveTypeBadge from '../../../components/ui/LeaveTypeBadge.jsx';
import RequestLeaveSlideOver from '../../../components/attendance/RequestLeaveSlideOver.jsx';
import {
  approveLeave,
  cancelLeave,
  listLeaves,
  rejectLeave,
} from '../../../services/leaveService.js';
import { listEmployees } from '../../../services/employeeService.js';
import { useAuthStore } from '../../../store/authStore.js';
import { toast } from '../../../store/toastStore.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'emergency', label: 'Emergency' },
];

const STATUS_TONES = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'muted',
};

function RejectionPrompt({ open, onCancel, onConfirm, busy }) {
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
      confirmLabel="Reject"
      title="Reject leave request"
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

function fmtDate(input) {
  return input
    ? new Date(`${input}T00:00:00`).toLocaleDateString('en-AE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—';
}

export default function LeavesTab() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const canApprove = hasPermission('attendance.correction_approve');

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState(null);
  const [items, setItems] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listLeaves({
        status: statusFilter || undefined,
        leaveType: typeFilter || undefined,
        employeeId: employeeFilter || undefined,
        limit: 100,
      });
      setItems(res?.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load leaves.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, employeeFilter]);

  useEffect(() => {
    if (!canApprove) return;
    (async () => {
      try {
        const res = await listEmployees({ limit: 200, isActive: true });
        setEmployees(res?.data || []);
      } catch (_e) {
        setEmployees([]);
      }
    })();
  }, [canApprove]);

  async function onApprove(leave) {
    setBusy(true);
    try {
      await approveLeave(leave.id);
      toast.success('Leave approved.');
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
      await rejectLeave(rejecting.id, reason);
      toast.success('Leave rejected.');
      setRejecting(null);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to reject.');
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(leave) {
    setBusy(true);
    try {
      await cancelLeave(leave.id);
      toast.success('Leave cancelled.');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel.');
    } finally {
      setBusy(false);
    }
  }

  const myItems = items.filter((l) => l.requestedBy === user?.id);
  const allItems = canApprove ? items : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Leave requests</h2>
          <p className="text-sm text-ink-muted">
            UAE Labour Law: 30 annual + 15 sick days per year.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Select
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
            searchable={false}
            containerClassName="w-40"
          />
          <Select
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_OPTIONS}
            searchable={false}
            containerClassName="w-36"
          />
          {canApprove && (
            <Select
              label="Employee"
              value={employeeFilter}
              onChange={setEmployeeFilter}
              options={[
                { value: null, label: 'All' },
                ...employees.map((e) => ({ value: e.id, label: e.name })),
              ]}
              containerClassName="w-56"
            />
          )}
          <Button onClick={() => setOpen(true)}>Request leave</Button>
        </div>
      </div>

      {canApprove && (
        <Section
          title="All requests"
          items={allItems}
          loading={loading}
          empty="No leave requests."
          render={(l) => (
            <LeaveRow
              key={l.id}
              leave={l}
              canApprove
              onApprove={onApprove}
              onReject={setRejecting}
              onCancel={onCancel}
              isOwn={l.requestedBy === user?.id}
            />
          )}
        />
      )}

      <Section
        title="My requests"
        items={myItems}
        loading={false}
        empty="You haven't submitted any leave requests yet."
        render={(l) => (
          <LeaveRow
            key={l.id}
            leave={l}
            canApprove={false}
            onCancel={onCancel}
            isOwn
          />
        )}
      />

      <RequestLeaveSlideOver
        open={open}
        onClose={() => setOpen(false)}
        employeeId={canApprove ? null : user?.employeeId}
        employees={canApprove ? employees : []}
        onSaved={refresh}
      />

      <RejectionPrompt
        open={Boolean(rejecting)}
        onCancel={() => setRejecting(null)}
        onConfirm={onReject}
        busy={busy}
      />
    </div>
  );
}

function Section({ title, items, loading, empty, render }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">
        {title}
      </h3>
      {loading ? (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
          {empty}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th className="text-right">Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>{items.map(render)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children, className = '' }) {
  return (
    <th
      className={`px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted ${className}`}
    >
      {children}
    </th>
  );
}

function LeaveRow({ leave, canApprove, onApprove, onReject, onCancel, isOwn }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3 font-medium">{leave.employeeName || '—'}</td>
      <td className="px-4 py-3">
        <LeaveTypeBadge type={leave.leaveType} />
      </td>
      <td className="px-4 py-3 tabular-nums">{fmtDate(leave.startDate)}</td>
      <td className="px-4 py-3 tabular-nums">{fmtDate(leave.endDate)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{leave.totalDays}</td>
      <td className="max-w-xs px-4 py-3 text-ink-muted">
        <p className="line-clamp-2">{leave.reason}</p>
        {leave.status === 'rejected' && leave.rejectionReason && (
          <p className="mt-1 text-xs text-error">
            Rejected: {leave.rejectionReason}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge tone={STATUS_TONES[leave.status] || 'muted'} size="sm">
          {leave.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          {canApprove && leave.status === 'pending' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onReject(leave)}>
                Reject
              </Button>
              <Button size="sm" onClick={() => onApprove(leave)}>
                Approve
              </Button>
            </>
          )}
          {isOwn && leave.status === 'pending' && (
            <Button variant="ghost" size="sm" onClick={() => onCancel(leave)}>
              Cancel
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
