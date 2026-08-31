import { cn } from '../../utils/cn.js';
import { formatCurrencyNumber } from '../../utils/format.js';
import DirhamSymbol from '../ui/DirhamSymbol.jsx';
import GrowthBadge from './GrowthBadge.jsx';
import SparklineChart from './SparklineChart.jsx';

// Compact metric tile. Supports currency / number / percent / raw values, an
// optional vs-previous percentage delta, and an inline sparkline.
export default function KPICard({
  label,
  value,
  unit = null,
  format = 'currency',
  delta = null,
  invertDelta = false,
  sparkline = null,
  hint = null,
  Icon = null,
  className = '',
  to = null,
}) {
  let display = value;
  if (value == null) {
    display = '—';
  } else if (format === 'currency') {
    display = (
      <>
        <DirhamSymbol /> {formatCurrencyNumber(Number(value) || 0)}
      </>
    );
  } else if (format === 'percent') {
    display = `${Number(value).toFixed(1)}%`;
  } else if (format === 'number') {
    display = Number(value).toLocaleString('en-AE');
  } else if (format === 'ratio') {
    display = `${Number(value).toFixed(2)}×`;
  }

  const Wrapper = to ? 'a' : 'div';
  const wrapperProps = to ? { href: to } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'block rounded-card border border-border bg-surface p-4',
        to && 'hover:border-accent hover:shadow-pop transition',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-ink leading-tight">
            {display}
            {unit && format !== 'percent' && (
              <span className="ml-1 text-sm font-normal text-ink-muted">{unit}</span>
            )}
          </div>
          {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
        </div>
        {Icon && (
          <div className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-accent-light text-accent">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {delta != null ? (
          <GrowthBadge value={delta} invertColor={invertDelta} />
        ) : (
          <span />
        )}
        {sparkline && sparkline.length > 0 && (
          <div className="flex-1 max-w-[120px]">
            <SparklineChart data={sparkline} height={32} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
