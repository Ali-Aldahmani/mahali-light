import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldOff,
  AlertTriangle,
} from 'lucide-react';
import Button from './Button.jsx';
import { formatDate } from '../../utils/format.js';

// Big colour-coded card used on the warranty lookup screen. Shows the
// warranty status, key meta, and quick action buttons.
const STATUS_META = {
  active: {
    label: 'ACTIVE',
    icon: ShieldCheck,
    classes:
      'border-success/30 bg-success-light/40 text-success',
    tile: 'border-success/30 bg-success-light/60 text-success',
  },
  expiring: {
    label: 'EXPIRING SOON',
    icon: AlertTriangle,
    classes:
      'border-warning/30 bg-warning-light/50 text-warning',
    tile: 'border-warning/30 bg-warning-light text-warning',
  },
  expired: {
    label: 'EXPIRED',
    icon: ShieldX,
    classes:
      'border-error/30 bg-error-light/40 text-error',
    tile: 'border-error/30 bg-error-light/60 text-error',
  },
  claimed: {
    label: 'CLAIMED',
    icon: ShieldAlert,
    classes: 'border-border bg-surface-2 text-ink-muted',
    tile: 'border-border bg-surface-2 text-ink-muted',
  },
  void: {
    label: 'VOID',
    icon: ShieldOff,
    classes: 'border-border bg-surface-2 text-ink-muted',
    tile: 'border-border bg-surface-2 text-ink-muted',
  },
};

function pickStatus(warranty) {
  if (!warranty) return 'active';
  if (warranty.status === 'active' && warranty.expiringSoon) return 'expiring';
  return warranty.status || 'active';
}

function durationLabel(daysRemaining) {
  if (daysRemaining == null) return null;
  if (daysRemaining < 0) {
    const ago = Math.abs(daysRemaining);
    return `Expired ${ago} day${ago === 1 ? '' : 's'} ago`;
  }
  if (daysRemaining <= 90) {
    return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`;
  }
  const months = Math.round(daysRemaining / 30);
  return `${months} month${months === 1 ? '' : 's'} remaining`;
}

export default function WarrantyStatusCard({
  warranty,
  onRaiseClaim,
  showActions = true,
}) {
  if (!warranty) return null;
  const key = pickStatus(warranty);
  const meta = STATUS_META[key] || STATUS_META.active;
  const Icon = meta.icon;
  const expiry = warranty.endDate ? formatDate(warranty.endDate) : '—';
  const dr = durationLabel(warranty.daysRemaining);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-muted">
        <Icon className="h-4 w-4" />
        Warranty status
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <Field label="Product" value={warranty.productName || '—'} />
        <Field label="Serial" value={warranty.serialNumber || '—'} mono />
        <Field label="Customer" value={warranty.customerName || 'Guest'} />
        <Field label="Phone" value={warranty.customerPhone || '—'} mono />
        <Field
          label="Invoice"
          value={
            warranty.invoiceNumber ? (
              <Link
                to={`/invoices/${warranty.invoiceId}`}
                className="text-accent hover:underline font-mono"
              >
                {warranty.invoiceNumber}
              </Link>
            ) : (
              '—'
            )
          }
        />
        <Field
          label="Purchased"
          value={warranty.startDate ? formatDate(warranty.startDate) : '—'}
        />
      </div>

      <div
        className={`rounded-card border p-4 flex items-center justify-between ${meta.tile}`}
      >
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {meta.label}
          </div>
          <div className="mt-1 text-xs">
            Expires: <span className="font-medium">{expiry}</span>
          </div>
        </div>
        {dr && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider opacity-80">
              {warranty.daysRemaining < 0 ? 'Lapsed' : 'Remaining'}
            </div>
            <div className="text-base font-semibold">{dr}</div>
          </div>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap gap-2">
          {warranty.status === 'active' && onRaiseClaim && (
            <Button onClick={() => onRaiseClaim(warranty)} variant="primary">
              Raise claim
            </Button>
          )}
          {warranty.invoiceId && (
            <Link to={`/invoices/${warranty.invoiceId}`}>
              <Button variant="secondary">View invoice</Button>
            </Link>
          )}
          <Link to={`/warranties/${warranty.id}`}>
            <Button variant="ghost">View full warranty</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className={`text-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
