import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

// Grouped bar chart used on the Overview tab. Shows Revenue / COGS / Net
// Profit per period — orange accent for Revenue, neutral grey for COGS,
// success green for Net Profit so the colour conveys meaning at a glance.
export default function NetProfitTrendChart({ rows = [], height = 320 }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        No trend data yet for this window.
      </div>
    );
  }
  const data = rows.map((r) => ({
    bucket: typeof r.bucket === 'string' ? r.bucket.slice(0, 10) : r.bucket,
    revenue: Number(r.revenue) || 0,
    cogs: Number(r.cogs) || 0,
    net_profit: Number(r.net_profit) || 0,
  }));
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="bucket" stroke="#6B7280" fontSize={12} tickMargin={6} />
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
          <Bar dataKey="revenue" fill="#F97316" name="Revenue" radius={[4, 4, 0, 0]} />
          <Bar dataKey="cogs" fill="#9CA3AF" name="COGS" radius={[4, 4, 0, 0]} />
          <Bar dataKey="net_profit" fill="#16A34A" name="Net Profit" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
