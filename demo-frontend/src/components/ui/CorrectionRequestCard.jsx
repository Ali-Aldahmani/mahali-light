import Button from './Button.jsx';
import Badge from './Badge.jsx';
import { ArrowRight, Clock } from 'lucide-react';

function fmt(input) {
  if (!input) return '—';
  return new Date(input).toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

const REASON_LABELS = {
  forgot_checkout: 'Forgot to check out',
  wrong_time: 'Wrong time',
  system_error: 'System error',
  other: 'Other',
};

const STATUS_TONES = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

// Compact card showing old vs new times with the requester's note. Used in
// the corrections tab — manager actions slot in via the action prop.
export default function CorrectionRequestCard({
  correction,
  canReview = false,
  onApprove = null,
  onReject = null,
}) {
  if (!correction) return null;
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {correction.employeeName || 'Unknown employee'}
          </p>
          <p className="text-xs text-ink-muted">
            {correction.attendanceDate} ·{' '}
            {REASON_LABELS[correction.reason] || correction.reason}
          </p>
        </div>
        <Badge tone={STATUS_TONES[correction.status] || 'muted'} size="sm">
          {correction.status}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 rounded-input bg-surface-2 p-3 text-xs">
        <div>
          <div className="mb-1 flex items-center gap-1 text-ink-muted">
            <Clock className="h-3 w-3" /> Before
          </div>
          <div className="font-medium tabular-nums">
            In: {fmt(correction.oldCheckIn)}
          </div>
          <div className="font-medium tabular-nums">
            Out: {fmt(correction.oldCheckOut)}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1 text-accent">
            <ArrowRight className="h-3 w-3" /> Requested
          </div>
          <div className="font-medium tabular-nums">
            In: {fmt(correction.newCheckIn)}
          </div>
          <div className="font-medium tabular-nums">
            Out: {fmt(correction.newCheckOut)}
          </div>
        </div>
      </div>

      {correction.requestNote && (
        <div className="mt-3 rounded-input border border-border bg-surface p-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">Note:</span> {correction.requestNote}
        </div>
      )}

      {correction.status === 'rejected' && correction.rejectionReason && (
        <div className="mt-3 rounded-input bg-error-light p-2 text-xs text-error">
          <span className="font-medium">Rejected:</span> {correction.rejectionReason}
        </div>
      )}

      {canReview && correction.status === 'pending' && (
        <div className="mt-3 flex justify-end gap-2">
          {onReject && (
            <Button variant="ghost" size="sm" onClick={() => onReject(correction)}>
              Reject
            </Button>
          )}
          {onApprove && (
            <Button variant="primary" size="sm" onClick={() => onApprove(correction)}>
              Approve
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
