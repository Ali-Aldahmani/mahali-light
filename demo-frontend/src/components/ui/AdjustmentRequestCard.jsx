import { Check, X } from 'lucide-react';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import { formatQty } from '../../utils/format.js';
import { formatRelativeTime } from '../../utils/format.js';

const REASON_LABELS = {
  damaged: 'Damaged',
  lost: 'Lost',
  found: 'Found',
  counting_error: 'Counting error',
  expired: 'Expired',
  other: 'Other',
};

const STATUS_TONES = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

// Compact card used in notification panels and lists. Also reused on the
// adjustments tab as the row body.
export default function AdjustmentRequestCard({
  request,
  onApprove,
  onReject,
  canReview = false,
}) {
  if (!request) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink truncate">
            {request.productName || '—'}
          </div>
          <div className="text-xs text-ink-muted truncate">
            {request.variantSku ? `SKU: ${request.variantSku}` : ''}
          </div>
        </div>
        <Badge tone={STATUS_TONES[request.status] || 'muted'} size="sm">
          {request.status}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-ink-muted">Current</div>
          <div className="font-medium">
            {formatQty(request.currentQty)}
            {request.unitLabel ? ` ${request.unitLabel}` : ''}
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">Requested</div>
          <div className="font-medium">
            {formatQty(request.requestedQty)}
            {request.unitLabel ? ` ${request.unitLabel}` : ''}
          </div>
        </div>
        <div>
          <div className="text-xs text-ink-muted">Change</div>
          <div
            className={
              request.difference > 0
                ? 'text-success font-semibold'
                : request.difference < 0
                  ? 'text-error font-semibold'
                  : 'font-medium'
            }
          >
            {request.difference > 0 ? '+' : ''}
            {formatQty(request.difference)}
          </div>
        </div>
      </div>

      <div className="text-xs text-ink-muted">
        <div>
          <span className="font-medium text-ink">
            {REASON_LABELS[request.reason] || request.reason}
          </span>
          {' · '}
          {request.requestedByUsername || '—'}{' '}
          {request.requestedAt
            ? `· ${formatRelativeTime(request.requestedAt)}`
            : ''}
        </div>
        {request.requestNote && (
          <div className="italic mt-1">"{request.requestNote}"</div>
        )}
        {request.status === 'rejected' && request.rejectionReason && (
          <div className="mt-1 text-error">
            Rejected: {request.rejectionReason}
          </div>
        )}
      </div>

      {canReview && request.status === 'pending' && (
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onReject?.(request)}
            leftIcon={<X className="h-4 w-4" />}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onApprove?.(request)}
            leftIcon={<Check className="h-4 w-4" />}
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}
