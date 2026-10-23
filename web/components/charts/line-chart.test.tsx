import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LineChart, { type LineChartDatum, type LineChartSeries } from './line-chart';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      root = null;
      rootMargin = '';
      thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});

const data: LineChartDatum[] = [
  { key: '2026-09-14', label: '14 Sep 2026', axisLabel: '14 Sep', values: { revenue: 1200, previous: 900 } },
  { key: '2026-09-15', label: '15 Sep 2026', axisLabel: '15 Sep', values: { revenue: 1800, previous: 1100 } },
  { key: '2026-09-16', label: '16 Sep 2026', axisLabel: '16 Sep', values: { revenue: 1500, previous: 1400 } },
];

const series: LineChartSeries[] = [
  { key: 'revenue', label: 'This period', area: true },
  { key: 'previous', label: 'Previous period', dashed: true, area: false },
];

describe('LineChart', () => {
  it('renders the labelled figure, legend, slider and screen-reader table', () => {
    render(
      <LineChart
        data={data}
        series={series}
        label="Revenue over time"
        categoryLabel="Date"
        formatValue={(value) => `AED ${value}`}
      />,
    );

    expect(screen.getByRole('figure', { name: 'Revenue over time' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /Revenue over time/i })).toBeInTheDocument();

    // Legend toggles for both series.
    expect(screen.getByRole('button', { name: /This period/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Previous period/i })).toHaveAttribute('aria-pressed', 'true');

    // The hidden data table is the accessible fallback for every point.
    expect(screen.getByText('14 Sep 2026')).toBeInTheDocument();
    expect(screen.getByText('AED 1800')).toBeInTheDocument();
  });

  it('toggles a series off from the legend', () => {
    render(<LineChart data={data} series={series} label="Revenue over time" />);

    const toggle = screen.getByRole('button', { name: /Previous period/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the empty label when there are no points', () => {
    render(
      <LineChart data={[]} series={series} label="Revenue over time" emptyLabel="No sales data for the selected period." />,
    );
    expect(screen.getByText('No sales data for the selected period.')).toBeInTheDocument();
  });
});
