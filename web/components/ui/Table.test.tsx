import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Table from './Table';

describe('Table component', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'price', header: 'Price' },
  ];
  const rows = [
    { id: '1', name: 'Product A', price: 10 },
    { id: '2', name: 'Product B', price: 20 },
  ];

  it('renders standard table rows without subRows', () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByText('Product A')).toBeInTheDocument();
    expect(screen.getByText('Product B')).toBeInTheDocument();
  });

  it('renders expandable subRow when row is in expandedRowKeys', () => {
    const expandedKeys = new Set(['1']);
    render(
      <Table
        columns={columns}
        rows={rows}
        expandedRowKeys={expandedKeys}
        renderSubRow={(row, isExpanded) => (
          <div data-testid={`subrow-${row.id}`}>
            Sub content for {row.name} (expanded: {String(isExpanded)})
          </div>
        )}
      />,
    );
    expect(screen.getByTestId('subrow-1')).toBeInTheDocument();
    expect(screen.getByText(/Sub content for Product A/)).toBeInTheDocument();
    expect(screen.queryByTestId('subrow-2')).not.toBeInTheDocument();
  });
});

