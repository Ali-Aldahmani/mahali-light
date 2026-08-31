import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

// Decoration-only inline chart for KPI cards. No axes, no legend, just a
// 7-point trend line in the brand accent colour. `data` is an array of
// objects: { value: number, label?: string }.
export default function SparklineChart({
  data = [],
  height = 40,
  color = '#F97316',
  showTooltip = false,
}) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div style={{ height }} className="rounded bg-surface-2" />;
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          {showTooltip && (
            <Tooltip
              contentStyle={{
                background: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                fontSize: 11,
                padding: '4px 8px',
              }}
              labelFormatter={() => ''}
              formatter={(v) => Number(v).toLocaleString('en-AE')}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
