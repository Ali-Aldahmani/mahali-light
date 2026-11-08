import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductColumnsConfig from './ProductColumnsConfig';

describe('ProductColumnsConfig component', () => {
  it('opens dropdown and toggles columns', () => {
    const toggleColumn = vi.fn();
    const resetToDefault = vi.fn();
    const visibleColumns = new Set(['product', 'price', 'stock']);

    render(
      <ProductColumnsConfig
        visibleColumns={visibleColumns}
        toggleColumn={toggleColumn}
        resetToDefault={resetToDefault}
        canViewCost={false}
      />,
    );

    const button = screen.getByRole('button', { name: /columns/i });
    fireEvent.click(button);

    expect(screen.getByText('Customize Columns')).toBeInTheDocument();
    expect(screen.queryByText('Cost Price')).not.toBeInTheDocument();

    const categoryCheckbox = screen.getByLabelText(/category/i);
    fireEvent.click(categoryCheckbox);
    expect(toggleColumn).toHaveBeenCalledWith('category');

    const resetButton = screen.getByRole('button', { name: /reset/i });
    fireEvent.click(resetButton);
    expect(resetToDefault).toHaveBeenCalled();
  });

  it('exposes Cost Price option only when canViewCost is true', () => {
    render(
      <ProductColumnsConfig
        visibleColumns={new Set(['product'])}
        toggleColumn={vi.fn()}
        resetToDefault={vi.fn()}
        canViewCost={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    expect(screen.getByText('Cost Price')).toBeInTheDocument();
  });
});

