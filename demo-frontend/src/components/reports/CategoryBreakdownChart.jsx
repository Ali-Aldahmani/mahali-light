import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#F97316',
  '#FB923C',
  '#FDBA74',
  '#16A34A',
  '#22C55E',
  '#CA8A04',
  '#DC2626',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
];

export default function CategoryBreakdownChart({ rows = [], nameKey = 'category_name', valueKey = 'revenue', height = 280 }) {
  if (!rows.length) {
    return (
      <div className="card border border-border p-8 text-center text-sm text-ink-muted">
        Nothing to plot.
      </div>
    );
  }
  return (
    <div className="card border border-border p-4">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={rows}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {rows.map((_entry, idx) => (
              <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
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
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
