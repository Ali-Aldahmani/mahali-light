import { AlertTriangle, Clock, FileText, User, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatCurrency, timeAgo } from '../../utils/format.js';
import Button from '../ui/Button.jsx';
import ReturnTypeBadge from '../ui/ReturnTypeBadge.jsx';
import ReturnStatusBadge from '../ui/ReturnStatusBadge.jsx';

export default function ReturnRequestCard({
  request,
  onApprove,
  onReject,
  isBusy = false,
}) {
  const r = request || {};
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Package className="h-4 w-4 text-accent" />
            <Link
              to={`/returns/requests/${r.id}`}
              className="font-mono text-base hover:text-accent"
            >
              {r.requestNumber}
            </Link>
            <ReturnTypeBadge type={r.returnType} size="sm" />
            <ReturnStatusBadge status={r.status} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {timeAgo(r.requestedAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {r.requestedByUsername || 'Unknown'}
            </span>
            {r.invoiceNumber && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {r.invoiceNumber}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">
            Total
          </div>
          <div className="text-base font-semibold text-ink">
            {formatCurrency(r.totalValue || 0)}
          </div>
        </div>
      </div>

      {(r.customerName || r.supplierName) && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">
              {r.supplierName ? 'Supplier' : 'Customer'}
            </div>
            <div className="font-medium text-ink">
              {r.customerName || r.supplierName}
            </div>
            {r.customerPhone && (
              <div className="text-xs text-ink-muted">{r.customerPhone}</div>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-muted">
              Reason
            </div>
            <div className="font-medium capitalize text-ink">
              {r.reason?.replace(/_/g, ' ') || '—'}
            </div>
          </div>
        </div>
      )}

      {r.requestNote && (
        <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink">
          <span className="text-ink-muted">Note: </span>
          “{r.requestNote}”
        </div>
      )}

      {r.noInvoiceReturn && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-light p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-semibold">No-invoice return</div>
            <div className="text-xs">
              Verify the goods and the customer's account manually before
              approving.
            </div>
          </div>
        </div>
      )}

      {r.status === 'pending' && (onApprove || onReject) && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => onReject && onReject(r)}
            disabled={isBusy}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            onClick={() => onApprove && onApprove(r)}
            disabled={isBusy}
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}
