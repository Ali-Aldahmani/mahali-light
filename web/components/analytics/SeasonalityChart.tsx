import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Cell,
  ReferenceLine,
} from 'recharts';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 24-month bar chart (units sold) with a seasonality-index line overlay.
// Peak months (>120 index) are filled in accent orange, slow months (<80)
// in a neutral grey, normal months in the lighter accent tint.
export default function SeasonalityChart({
  series = [],
  monthlyAvg = [],
  height = 320,
  highlightCurrentMonth = true,
}) {
  if (!series.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        Not enough history yet to detect seasonality for this product.
      </div>
    );
  }
  const data = series.map((r) => ({
    label: `${MONTH[r.month - 1]} ${String(r.year).slice(2)}`,
    units: Number(r.units) || 0,
    year: r.year,
    month: r.month,
    seasonality_index:
      monthlyAvg.find((a) => Number(a.month) === Number(r.month))?.seasonality_index || 0,
  }));
  const today = new Date();
  const currentLabel = `${MONTH[today.getMonth()]} ${String(today.getFullYear()).slice(2)}`;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 32, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" stroke="#6B7280" fontSize={11} interval={0} tickMargin={6} />
          <YAxis yAxisId="left" stroke="#6B7280" fontSize={12} />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#F97316"
            fontSize={11}
            domain={[0, 'dataMax + 20']}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{
              background: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === 'Seasonality Index') return `${Number(value).toFixed(1)}`;
              return Number(value).toLocaleString('en-AE');
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {highlightCurrentMonth && (
            <ReferenceLine
              yAxisId="left"
              x={currentLabel}
              stroke="#F97316"
              strokeDasharray="4 2"
              label={{ value: 'Now', position: 'top', fill: '#F97316', fontSize: 11 }}
            />
          )}
          <Bar yAxisId="left" dataKey="units" name="Units sold" radius={[4, 4, 0, 0]}>
            {data.map((d, idx) => {
              const idx2 = d.seasonality_index;
              const color =
                idx2 > 120 ? '#F97316' : idx2 < 80 ? '#9CA3AF' : '#FDBA74';
              return <Cell key={`c-${idx}`} fill={color} />;
            })}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="seasonality_index"
            stroke="#F97316"
            strokeWidth={2}
            dot={false}
            name="Seasonality Index"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
