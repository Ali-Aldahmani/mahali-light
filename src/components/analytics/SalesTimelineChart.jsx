import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
} from 'recharts';
import { formatDate } from '../../utils/format.js';

// Area chart for the dashboard. Renders revenue per day plus an optional
// faint "previous period" comparison line so growth is obvious at a glance.
export default function SalesTimelineChart({
  rows = [],
  height = 280,
  showComparison = true,
}) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        No sales data for the selected period.
      </div>
    );
  }
  const data = rows.map((r) => ({
    bucket: typeof r.bucket === 'string' ? r.bucket.slice(0, 10) : r.bucket,
    label: formatDate(r.bucket),
    revenue: Number(r.revenue) || 0,
    previous_revenue: Number(r.previous_revenue) || 0,
  }));
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F97316" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" stroke="#6B7280" fontSize={11} tickMargin={6} />
          <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            formatter={(value) =>
              `AED ${Number(value).toLocaleString('en-AE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            }
            contentStyle={{
              background: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#F97316"
            strokeWidth={2}
            fill="url(#revenueFill)"
            name="This period"
          />
          {showComparison && (
            <Line
              type="monotone"
              dataKey="previous_revenue"
              stroke="#9CA3AF"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              name="Previous period"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
