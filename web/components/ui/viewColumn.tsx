'use client';

import { Eye } from 'lucide-react';
import RowActions from './RowActions';
import type { TableColumn } from './Table';

/**
 * An actions column with a single View button, for tables whose rows only
 * open a record. Rows aren't clickable, so this is how a record opens.
 *
 *   columns={[...columns, viewColumn({ label: 'Purchase order actions', onView: (r) => router.push(`/purchase-orders/${r.id}`) })]}
 */
export function viewColumn<Row = any>({
  onView,
  label = 'Row actions',
}: {
  onView: (row: Row) => void;
  label?: string;
}): TableColumn {
  return {
    key: 'actions',
    header: '',
    align: 'right',
    sortable: false,
    render: (row: Row) => (
      <RowActions
        label={label}
        actions={[{ id: 'view', label: 'View', icon: <Eye />, onClick: () => onView(row) }]}
      />
    ),
  };
}

export default viewColumn;
