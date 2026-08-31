import { useMemo, useState } from 'react';
import Table from '../ui/Table.jsx';
import { cn } from '../../utils/cn.js';

// Formats a single cell value according to the column type. Mirrors what
// the backend exporters do server-side so the on-screen table matches
// downloaded files.
export function formatCell(value, type) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (type === 'currency')
    return `AED ${Number.isFinite(n)
      ? n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : value}`;
  if (type === 'number')
    return Number.isFinite(n)
      ? n.toLocaleString('en-AE', { maximumFractionDigits: 2 })
      : value;
  if (type === 'percent')
    return `${Number.isFinite(n) ? n.toLocaleString('en-AE', { maximumFractionDigits: 1 }) : value}%`;
  if (type === 'int') return Number.isFinite(n) ? n.toLocaleString('en-AE') : value;
  if (type === 'date') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  if (type === 'datetime') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return String(value);
}

// Drives the generic report table — accepts the report's `columns` + `rows`
// shape returned by the backend dispatcher. Renders a totals row inline so
// PDF and on-screen views stay aligned.
export default function ReportTable({
  report,
  pageSize = 50,
  className = '',
}) {
  const [page, setPage] = useState(1);

  const columns = useMemo(() => {
    const cols = report?.columns || [];
    return cols.map((c) => ({
      key: c.key,
      header: c.label,
      align: c.align || (c.type === 'currency' || c.type === 'percent' || c.type === 'number' || c.type === 'int' ? 'right' : 'left'),
      sortable: !report?.grid,
      render: (row) => formatCell(row[c.key], c.type),
    }));
  }, [report]);

  const rows = report?.rows || [];
  const totalRows = rows.length;
  const start = (page - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);
  const showPager = totalRows > pageSize;

  if (!report) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Table
        columns={columns}
        rows={visible}
        rowKey={(row, idx) => `${row.id || idx}`}
        empty="No data for the selected filters."
        pagination={
          showPager
            ? {
                page,
                pageSize,
                total: totalRows,
                onPageChange: setPage,
              }
            : null
        }
      />
      {report.totals && (
        <div className="card border border-border p-3">
          <div className="grid grid-flow-col auto-cols-fr gap-3 text-sm">
            <div className="text-ink-muted uppercase tracking-wide text-xs font-semibold flex items-center">
              Totals
            </div>
            {(report.columns || []).map((c) => {
              if (report.totals[c.key] == null) return <div key={c.key} />;
              return (
                <div key={c.key} className={c.align === 'right' ? 'text-right' : 'text-left'}>
                  <div className="text-[10px] text-ink-muted uppercase">{c.label}</div>
                  <div className="font-semibold text-ink">
                    {formatCell(report.totals[c.key], c.type)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
