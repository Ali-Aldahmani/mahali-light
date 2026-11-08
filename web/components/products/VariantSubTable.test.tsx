import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VariantSubTable from './VariantSubTable';

describe('VariantSubTable component', () => {
  const mockProduct = {
    id: 'prod-1',
    name: 'LED Light Bulb',
    soldBy: 'piece',
    unitLabel: 'pcs',
  };

  const mockVariants = [
    {
      id: 'var-1',
      sku: 'BULB-9W-WARM',
      barcode: '6291040001',
      internalBarcode: 'INT-001',
      supplierBarcode: 'SUP-001',
      sellingPrice: 25.5,
      costPrice: 15.0,
      stockQty: 50,
      reorderThreshold: 10,
      quarantineQty: 0,
      isActive: true,
      attributes: [{ attributeName: 'Color', value: 'Warm White', unit: '' }],
    },
    {
      id: 'var-2',
      sku: 'BULB-12W-COOL',
      barcode: '6291040002',
      internalBarcode: 'INT-002',
      supplierBarcode: null,
      sellingPrice: 35.0,
      costPrice: 20.0,
      stockQty: 5,
      reorderThreshold: 10,
      quarantineQty: 2,
      isActive: true,
      attributes: [{ attributeName: 'Color', value: 'Cool Daylight', unit: '' }],
    },
  ];

  it('renders all variant rows with independent SKU, barcodes, and pricing', () => {
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        selectedVariantIds={new Set()}
        onToggleVariant={vi.fn()}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
        canViewCost={false}
      />,
    );

    expect(screen.getByText('BULB-9W-WARM')).toBeInTheDocument();
    expect(screen.getByText('BULB-12W-COOL')).toBeInTheDocument();
    expect(screen.getByText('6291040001')).toBeInTheDocument();
    expect(screen.getByText('6291040002')).toBeInTheDocument();
    expect(screen.getByText('25.50')).toBeInTheDocument();
    expect(screen.getByText('35.00')).toBeInTheDocument();
  });

  it('strictly hides cost price when canViewCost is false (permission security)', () => {
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        selectedVariantIds={new Set()}
        onToggleVariant={vi.fn()}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
        canViewCost={false}
      />,
    );

    expect(screen.queryByText('Cost Price')).not.toBeInTheDocument();
    expect(screen.queryByText('15.00')).not.toBeInTheDocument();
    expect(screen.queryByText('20.00')).not.toBeInTheDocument();
  });

  it('displays cost price when canViewCost is true', () => {
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        selectedVariantIds={new Set()}
        onToggleVariant={vi.fn()}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
        canViewCost={true}
      />,
    );

    expect(screen.getByText('Cost Price')).toBeInTheDocument();
    expect(screen.getByText('15.00')).toBeInTheDocument();
    expect(screen.getByText('20.00')).toBeInTheDocument();
  });

  it('highlights matching SKU or barcode and shows Search Match badge', () => {
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        searchQuery="WARM"
        selectedVariantIds={new Set()}
        onToggleVariant={vi.fn()}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
      />,
    );

    expect(screen.getByText('Search Match')).toBeInTheDocument();
  });

  it('triggers onToggleVariant when checkbox is clicked', () => {
    const onToggle = vi.fn();
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        selectedVariantIds={new Set(['var-1'])}
        onToggleVariant={onToggle}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();

    fireEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenCalledWith('var-2');
  });

  it('displays quarantine indicator when quarantineQty > 0', () => {
    render(
      <VariantSubTable
        product={mockProduct}
        variants={mockVariants}
        selectedVariantIds={new Set()}
        onToggleVariant={vi.fn()}
        onEditVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
      />,
    );

    expect(screen.getByText('(2 quarantined)')).toBeInTheDocument();
  });
});

