import { Link } from 'react-router-dom';
import WarrantyStatusBadge from './WarrantyStatusBadge.jsx';
import DaysRemainingBadge from './DaysRemainingBadge.jsx';
import { formatDate } from '../../utils/format.js';

// Compact warranty card used in customer profile / invoice detail / dashboards.
export default function WarrantyCard({ warranty, className = '' }) {
  if (!warranty) return null;
  return (
    <Link
      to={`/warranties/${warranty.id}`}
      className={`card p-4 flex flex-col gap-2 hover:border-accent transition-colors ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink-muted">
          {warranty.warrantyNumber}
        </span>
        <WarrantyStatusBadge
          status={warranty.status}
          expiringSoon={warranty.expiringSoon}
          size="sm"
        />
      </div>
      <div className="text-sm font-medium text-ink line-clamp-2">
        {warranty.productName || '—'}
      </div>
      {warranty.serialNumber && (
        <div className="text-xs text-ink-muted font-mono">
          SN: {warranty.serialNumber}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">
          {formatDate(warranty.startDate)} → {formatDate(warranty.endDate)}
        </span>
        {warranty.status === 'active' && (
          <DaysRemainingBadge
            daysRemaining={warranty.daysRemaining}
            size="sm"
          />
        )}
      </div>
    </Link>
  );
}
