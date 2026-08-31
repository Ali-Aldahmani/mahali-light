import { useState } from 'react';
import { cn } from '../../utils/cn.js';
import { formatCurrency } from '../../utils/format.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Renders a 7×24 grid coloured from #FFF0E6 (lightest) to #F97316 (peak).
// Accepts the raw cells from analyticsService.getPeakHeatmap. Hover surfaces
// invoice count + revenue. UAE weekend rows (Fri/Sat) get a subtle bg accent
// so the workweek pattern reads naturally.
export default function PeakHoursHeatmap({
  cells = [],
  maxCount = 0,
  showLegend = true,
  compact = false,
}) {
  const [hover, setHover] = useState(null);

  function intensity(count) {
    if (!maxCount || !count) return 0;
    return Math.min(1, count / maxCount);
  }

  function cellColor(count) {
    const t = intensity(count);
    if (t === 0) return '#F0F1F5';
    // Linear blend between accent-light (#FFF0E6) and accent (#F97316).
    const r1 = 255;
    const g1 = 240;
    const b1 = 230;
    const r2 = 249;
    const g2 = 115;
    const b2 = 22;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const cellsByKey = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c]));
  const cellSize = compact ? 14 : 22;

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <div className="flex">
          <div style={{ width: 36 }} />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="text-[10px] text-ink-muted text-center"
              style={{ width: cellSize, marginLeft: 2 }}
            >
              {h % 3 === 0 ? `${String(h).padStart(2, '0')}` : ''}
            </div>
          ))}
        </div>
        {Array.from({ length: 7 }, (_, d) => (
          <div key={d} className="flex items-center">
            <div
              className={cn(
                'text-xs text-ink-muted text-right pr-2',
                (d === 5 || d === 6) && 'text-accent',
              )}
              style={{ width: 36 }}
            >
              {DAY_LABELS[d]}
            </div>
            {Array.from({ length: 24 }, (_, h) => {
              const cell = cellsByKey.get(`${d}-${h}`) || { invoice_count: 0, revenue: 0 };
              const isHover = hover && hover.dow === d && hover.hour === h;
              return (
                <button
                  key={h}
                  type="button"
                  onMouseEnter={() => setHover({ dow: d, hour: h, ...cell })}
                  onMouseLeave={() => setHover(null)}
                  className={cn(
                    'rounded-sm transition border border-transparent',
                    isHover && 'ring-2 ring-accent ring-offset-1',
                  )}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    marginLeft: 2,
                    background: cellColor(cell.invoice_count),
                  }}
                  aria-label={`${DAY_LABELS[d]} ${h}:00 — ${cell.invoice_count} invoices`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
        {showLegend && (
          <div className="flex items-center gap-2">
            <span>Low</span>
            <div
              className="h-3 w-32 rounded"
              style={{
                background:
                  'linear-gradient(to right, #FFF0E6, #FDBA74, #F97316)',
              }}
            />
            <span>High</span>
          </div>
        )}
        {hover && (
          <div className="text-ink">
            {DAY_LABELS[hover.dow]} {String(hover.hour).padStart(2, '0')}:00 —{' '}
            <strong>{hover.invoice_count}</strong> invoices ·{' '}
            {formatCurrency(hover.revenue)}
          </div>
        )}
      </div>
    </div>
  );
}
