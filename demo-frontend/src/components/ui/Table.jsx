import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import Spinner from './Spinner.jsx';
import Button from './Button.jsx';

// columns: [{ key, header, render?, sortable?, width?, align?, accessor? }]
// rows: any[]
// rowKey: (row) => string
export default function Table({
  columns,
  rows,
  rowKey = (row) => row.id,
  loading = false,
  empty = null,
  onRowClick,
  initialSort = null, // { key, direction: 'asc' | 'desc' }
  // pagination is optional, controlled by parent
  pagination = null, // { page, pageSize, total, onPageChange }
  className = '',
}) {
  const [sort, setSort] = useState(initialSort);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const accessor = col.accessor || ((row) => row[col.key]);
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    if (sort.direction === 'desc') sorted.reverse();
    return sorted;
  }, [rows, sort, columns]);

  function toggleSort(key) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 0;

  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 text-ink-muted">
              {columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-ink',
                          isSorted && 'text-ink',
                        )}
                      >
                        {col.header}
                        {!isSorted && <ChevronsUpDown size={12} className="opacity-60" />}
                        {isSorted && sort.direction === 'asc' && <ChevronUp size={12} />}
                        {isSorted && sort.direction === 'desc' && <ChevronDown size={12} />}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <Spinner size="md" className="text-accent" />
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center text-ink-muted">
                  {empty || 'No results to display.'}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, idx) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-t border-border transition',
                    idx % 2 === 1 ? 'bg-bg/40' : 'bg-surface',
                    onRowClick && 'cursor-pointer hover:bg-accent-light/40',
                  )}
                >
                  {columns.map((col) => {
                    const accessor = col.accessor || ((r) => r[col.key]);
                    const content = col.render ? col.render(row) : accessor(row);
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'px-4 py-3 text-ink align-middle',
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center',
                        )}
                      >
                        {content ?? <span className="text-ink-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between border-t border-border bg-surface px-4 py-3 text-sm">
          <span className="text-ink-muted">
            {pagination.total === 0
              ? 'Showing 0 results'
              : `Showing ${(pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total,
                )} of ${pagination.total}`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <span className="text-ink-muted px-2">
              Page {pagination.page} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
