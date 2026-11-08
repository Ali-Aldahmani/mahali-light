import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { useProductStore } from '@/store/productStore';
import ProductsPage from './page';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});

const mockListProducts = vi.fn();
const mockDeleteProduct = vi.fn();
const mockDeleteVariant = vi.fn();
const mockBulkApplyMaxDiscount = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/services/productService', () => ({
  listProducts: (...args: any[]) => mockListProducts(...args),
  deleteProduct: (...args: any[]) => mockDeleteProduct(...args),
}));

vi.mock('@/services/variantService', () => ({
  deleteVariant: (...args: any[]) => mockDeleteVariant(...args),
}));

vi.mock('@/services/pricingRestrictionService', () => ({
  bulkApplyMaxDiscount: (...args: any[]) => mockBulkApplyMaxDiscount(...args),
}));

vi.mock('@/store/socketStore', () => ({
  onProductUpdate: () => () => {},
}));

const mockProducts = [
  {
    id: 'prod-1',
    name: 'Smart Switch 2-Gang',
    brand: 'Schneider',
    soldBy: 'piece',
    unitLabel: 'pcs',
    hasVariants: true,
    variantCount: 2,
    totalStock: 30,
    minPrice: 40,
    maxPrice: 55,
    reorderThreshold: 10,
    isActive: true,
    pricingRestriction: {
      minPrice: 35.0,
      maxDiscountPercent: 15.0,
      maxDiscountAmount: null,
    },
    variants: [
      {
        id: 'var-1',
        sku: 'SW-2G-WHT',
        barcode: '6290000001',
        sellingPrice: 40.0,
        costPrice: 25.0,
        stockQty: 20,
        reorderThreshold: 5,
        isActive: true,
        attributes: [{ attributeName: 'Color', value: 'White' }],
      },
      {
        id: 'var-2',
        sku: 'SW-2G-BLK',
        barcode: '6290000002',
        sellingPrice: 55.0,
        costPrice: 30.0,
        stockQty: 10,
        reorderThreshold: 5,
        isActive: true,
        attributes: [{ attributeName: 'Color', value: 'Black' }],
      },
    ],
  },
];

describe('ProductsPage - Product-first, Expandable Variants', () => {
  beforeEach(() => {
    mockListProducts.mockReset().mockResolvedValue({
      data: mockProducts,
      meta: { page: 1, limit: 20, total: 1 },
    });
    mockBulkApplyMaxDiscount.mockReset().mockResolvedValue([]);

    useAuthStore.setState({
      permissions: [
        'product.view',
        'product.edit',
        'product.delete',
        'product.manage_pricing_restrictions',
        'product.view_cost',
      ],
      user: {
        id: 'user-admin',
        username: 'admin',
        role: 'Admin',
        permissions: [
          'product.view',
          'product.edit',
          'product.delete',
          'product.manage_pricing_restrictions',
          'product.view_cost',
        ],
      },
      token: 'jwt-token',
    });

    useProductStore.setState({
      categoriesTree: [],
      fetchCategories: vi.fn(),
      refreshAll: vi.fn(),
    });
  });

  it('renders parent product row with aggregate details and expands variants on click', async () => {
    render(<ProductsPage />);

    expect(await screen.findByText('Smart Switch 2-Gang')).toBeInTheDocument();
    expect(screen.getByText(/40.00 – 55.00/)).toBeInTheDocument();
    expect(screen.getByText('Floor: AED 35.00')).toBeInTheDocument();
    expect(screen.getByText('Max Disc: 15%')).toBeInTheDocument();

    // Variants should initially be hidden
    expect(screen.queryByText('SW-2G-WHT')).not.toBeInTheDocument();

    // Click expand chevron
    const expandBtn = screen.getByLabelText('Expand Smart Switch 2-Gang');
    fireEvent.click(expandBtn);

    // Now variant sub-table should be visible
    expect(await screen.findByText('SW-2G-WHT')).toBeInTheDocument();
    expect(screen.getByText('SW-2G-BLK')).toBeInTheDocument();
    expect(screen.getByText('6290000001')).toBeInTheDocument();
    expect(screen.getByText('6290000002')).toBeInTheDocument();
  });

  it('supports hierarchical selection between parent and variants', async () => {
    render(<ProductsPage />);
    await screen.findByText('Smart Switch 2-Gang');

    // Click parent checkbox
    const parentCheckbox = screen.getByLabelText('Select Smart Switch 2-Gang');
    fireEvent.click(parentCheckbox);

    // Expand to verify variants are selected
    const expandBtn = screen.getByLabelText('Expand Smart Switch 2-Gang');
    fireEvent.click(expandBtn);

    const var1Checkbox = screen.getByLabelText('Select variant SW-2G-WHT');
    const var2Checkbox = screen.getByLabelText('Select variant SW-2G-BLK');
    expect(var1Checkbox).toBeChecked();
    expect(var2Checkbox).toBeChecked();

    // Uncheck one variant -> parent should become indeterminate
    fireEvent.click(var1Checkbox);
    expect(var1Checkbox).not.toBeChecked();
    expect(var2Checkbox).toBeChecked();
    expect(screen.getByText('1 product · 1 variant selected')).toBeInTheDocument();
  });

  it('bulk deactivate spares a variant that was unticked under a ticked product', async () => {
    render(<ProductsPage />);
    await screen.findByText('Smart Switch 2-Gang');

    fireEvent.click(screen.getByLabelText('Select Smart Switch 2-Gang'));
    fireEvent.click(screen.getByLabelText('Expand Smart Switch 2-Gang'));
    fireEvent.click(screen.getByLabelText('Select variant SW-2G-WHT'));

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate selected' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate all selected' }));

    await waitFor(() => expect(mockDeleteVariant).toHaveBeenCalledTimes(1));
    expect(mockDeleteProduct).not.toHaveBeenCalled();
    const kept = mockProducts[0].variants.find((v: any) => v.sku === 'SW-2G-WHT');
    expect(mockDeleteVariant.mock.calls[0][1]).not.toBe(kept?.id);
  });

  it('reveals bulk actions bar and opens modal for applying max discount', async () => {
    render(<ProductsPage />);
    await screen.findByText('Smart Switch 2-Gang');

    const parentCheckbox = screen.getByLabelText('Select Smart Switch 2-Gang');
    fireEvent.click(parentCheckbox);

    const bulkBtn = screen.getByRole('button', { name: /Apply max discount/i });
    expect(bulkBtn).toBeInTheDocument();

    fireEvent.click(bulkBtn);
    expect(screen.getByText('Apply max discount to selected products')).toBeInTheDocument();
  });
});
