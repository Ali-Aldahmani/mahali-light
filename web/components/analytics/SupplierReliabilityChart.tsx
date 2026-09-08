import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';

// Horizontal-style bar (Recharts uses `layout='vertical'` for that). Colours
// each bar by reliability bucket: green <2%, amber 2–5%, red >5%.
export default function SupplierReliabilityChart({ rows = [], height = 280 }) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
        Not enough supplier history for a reliability comparison.
      </div>
    );
  }
  const data = rows.map((r) => ({
    name: r.supplier_name,
    defect_rate: Number(r.defect_rate_pct) || 0,
  }));
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis type="number" stroke="#6B7280" fontSize={12} tickFormatter={(v) => `${v}%`} />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#6B7280"
            fontSize={12}
            width={140}
          />
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(1)}%`}
            contentStyle={{
              background: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="defect_rate" radius={[0, 4, 4, 0]}>
            {data.map((entry, idx) => {
              const v = entry.defect_rate;
              const color = v < 2 ? '#16A34A' : v <= 5 ? '#F97316' : '#DC2626';
              return <Cell key={`cell-${idx}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
