// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import POSProductCard from './POSProductCard';
import POSItemContextMenu from './POSItemContextMenu';
import { useAuthStore } from '@/store/authStore';

describe('POSProductCard & POSItemContextMenu', () => {
  const inStockVariant = {
    variantId: 101,
    productId: 1,
    productName: 'LED Bulb 12W',
    sku: 'LGH-GNX-0001',
    sellingPrice: 100,
    stockQty: 5,
    unitLabel: 'pcs',
  };

  const outOfStockVariant = {
    variantId: 102,
    productId: 2,
    productName: 'product 1',
    sku: 'LGH-GNX-0002',
    sellingPrice: 100,
    stockQty: 0,
    unitLabel: 'pcs',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      permissions: ['stock.adjust_request', 'supplier.purchase_order.create', 'product.edit'],
    });
  });

  it('offers only the quick actions the user has permission for', () => {
    const props = {
      open: true,
      x: 120,
      y: 150,
      variant: inStockVariant,
      onClose: vi.fn(),
      onQuickAddStock: vi.fn(),
      onQuickMakePO: vi.fn(),
      onQuickEdit: vi.fn(),
    };

    useAuthStore.setState({ permissions: ['stock.adjust_direct'] });
    const { unmount } = render(<POSItemContextMenu {...props} />);
    expect(screen.getByRole('menuitem', { name: /Quick add stock/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Quick make PO/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Quick edit/i })).toBeNull();
    unmount();

    // A cashier holds none of them, so there is no menu at all.
    useAuthStore.setState({ permissions: ['invoice.create', 'product.view'] });
    render(<POSItemContextMenu {...props} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('calls onClick and onContextMenu on in-stock item card', () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();

    render(
      <POSProductCard
        variant={inStockVariant}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />,
    );

    const card = screen.getByRole('button', { name: /LED Bulb 12W/i });
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledWith(inStockVariant);

    fireEvent.contextMenu(card);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][1]).toEqual(inStockVariant);
  });

  it('prevents left-click on out-of-stock card but still fires right-click onContextMenu', () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();

    render(
      <POSProductCard
        variant={outOfStockVariant}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />,
    );

    const card = screen.getByRole('button', { name: /product 1/i });
    fireEvent.click(card);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.contextMenu(card);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][1]).toEqual(outOfStockVariant);
  });

  it('renders Quick add stock, Quick make PO, and Quick edit options in POSItemContextMenu', () => {
    const onClose = vi.fn();
    const onQuickAddStock = vi.fn();
    const onQuickMakePO = vi.fn();
    const onQuickEdit = vi.fn();

    render(
      <POSItemContextMenu
        open={true}
        x={120}
        y={150}
        variant={outOfStockVariant}
        onClose={onClose}
        onQuickAddStock={onQuickAddStock}
        onQuickMakePO={onQuickMakePO}
        onQuickEdit={onQuickEdit}
      />,
    );

    const addStockBtn = screen.getByRole('menuitem', { name: /Quick add stock/i });
    const makePoBtn = screen.getByRole('menuitem', { name: /Quick make PO/i });
    const editBtn = screen.getByRole('menuitem', { name: /Quick edit/i });

    expect(addStockBtn).toBeTruthy();
    expect(makePoBtn).toBeTruthy();
    expect(editBtn).toBeTruthy();

    fireEvent.click(addStockBtn);
    expect(onQuickAddStock).toHaveBeenCalledWith(outOfStockVariant);

    fireEvent.click(makePoBtn);
    expect(onQuickMakePO).toHaveBeenCalledWith(outOfStockVariant);

    fireEvent.click(editBtn);
    expect(onQuickEdit).toHaveBeenCalledWith(outOfStockVariant);
  });
});

