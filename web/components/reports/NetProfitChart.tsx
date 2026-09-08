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

// Side-by-side comparison of Revenue / COGS / Expenses / Net Profit across
// the period buckets returned by the net-profit report.
export default function NetProfitChart({ rows = [], height = 280 }) {
  if (!rows.length) {
    return (
      <div className="card border border-border p-8 text-center text-sm text-ink-muted">
        Run the report to see the trend chart.
      </div>
    );
  }
  return (
    <div className="card border border-border p-4">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="period" stroke="#6B7280" fontSize={12} tickMargin={6} />
          <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(v) => `${v / 1000}k`} />
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
          <Bar dataKey="revenue"     fill="#F97316" name="Revenue" radius={[4, 4, 0, 0]} />
          <Bar dataKey="cogs"        fill="#FB923C" name="COGS"    radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses"    fill="#FDBA74" name="Expenses" radius={[4, 4, 0, 0]} />
          <Bar dataKey="net_profit"  fill="#16A34A" name="Net Profit" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
