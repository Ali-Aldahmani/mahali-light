import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getProductLifecycle: vi.fn(),
  getLifecycleReceipts: vi.fn(),
  getLifecycleSales: vi.fn(),
  getLifecycleTimeline: vi.fn(),
}));
vi.mock('@/services/productLifecycleService', () => api);
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

import ProductLifecycleTab from './ProductLifecycleTab';

const receipt = {
  receiptId: 'r1', batchId: 'b1', batchNumber: 'B-000001', sku: 'TH-1', sourceType: 'purchase_order',
  purchaseOrderId: 'po1', poNumber: 'PO-0001', supplierName: 'Alpha Trading', receivedAt: '2026-08-01T08:00:00Z',
  received: 10, sold: 10, returned: 0, remaining: 0, daysInStock: 100, unitCost: 10,
};
function lifecycle({ withCost }: { withCost: boolean }) {
  const cost = (o: any) => (withCost ? o : {});
  return {
    product: { id: 'p1', name: 'Traced Heater' },
    period: { startDate: '2026-08-01', endDate: '2026-11-10' },
    overview: {
      firstReceivedAt: '2026-08-01T08:00:00Z', lastReceivedAt: '2026-11-10T08:00:00Z', totalReceived: 25,
      soldUnits: 16, returnedUnits: 3, netSoldUnits: 13, available: 11, quarantined: 0, reserved: null, writtenOff: 1,
      revenue: 1300, ...cost({ cogs: 520, grossProfit: 780, grossMarginPct: 60, paymentFees: 30, contribution: 750, inventoryValue: 120 }),
    },
    costGroups: [{
      batchId: 'b1', batchNumber: 'B-000001', sku: 'TH-1', received: 20, sold: 16, returned: 3, remaining: 6,
      averageDaysToSale: 72.5, revenue: 1200, ...cost({ unitCost: 10, grossProfit: 700, contribution: 680 }),
      receipts: [withCost ? receipt : { ...receipt, unitCost: undefined }],
    }],
    aging: {
      buckets: [
        { key: '0_30', label: '0–30 days', quantity: 5 }, { key: '31_60', label: '31–60 days', quantity: 6 },
        { key: '61_90', label: '61–90 days', quantity: 0 }, { key: '91_180', label: '91–180 days', quantity: 0 },
        { key: '180_plus', label: '180+ days', quantity: 0 },
      ],
      averageAgeDays: 24.5, averageDaysToSale: 60, oldestRemaining: { batchNumber: 'B-000001', days: 45, remaining: 6 },
    },
    performance: {
      period: { startDate: '2026-08-01', endDate: '2026-11-10', days: 101 }, classification: 'slow',
      velocityPerDay: 0.13, daysOfCover: 84.6, sellThroughPct: 52, lastSaleAt: '2026-11-10T09:00:00Z', daysSinceLastSale: 0,
      ...cost({ turnover: 4.2, netCogs: 520, averageValue: 123.81 }),
    },
    stockouts: [],
  };
}

describe('ProductLifecycleTab', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    api.getLifecycleReceipts.mockResolvedValue({ rows: [receipt], total: 1, page: 1, limit: 20 });
    api.getLifecycleSales.mockResolvedValue({
      rows: [{
        lineId: 'l1', invoiceId: 'inv1', invoiceNumber: 'INV-2026-00001', soldAt: '2026-11-10T09:00:00Z',
        quantity: 12, unitPrice: 100, discount: 0, returnedQuantity: 2, exchanged: false, isReplacement: false,
        revenue: 1000, cogs: 400, grossProfit: 600, contribution: 580,
        allocations: [{ batchNumber: 'B-000001', receiptId: 'r1', quantity: 10, returnedQuantity: 0, receivedAt: '2026-08-01', unitCost: 10 }],
      }],
      total: 1, page: 1, limit: 20,
    });
    api.getLifecycleTimeline.mockResolvedValue({
      rows: [{ kind: 'movement', id: 'm1', at: '2026-11-10T09:00:00Z', type: 'sale', quantity: -12, employee: 'admin',
        sku: 'TH-1', link: '/invoices/inv1', batches: [{ batchNumber: 'B-000001', onHandChange: -10 }], valueChange: -400 }],
      total: 1, page: 1, limit: 25,
    });
  });

  it('shows the overview, groups, aging, receipts, sales and timeline with links to the records', async () => {
    api.getProductLifecycle.mockResolvedValue(lifecycle({ withCost: true }));
    render(<ProductLifecycleTab productId="p1" unitLabel="pcs" />);
    expect(await screen.findByText('Total received')).toBeInTheDocument();
    expect(screen.getAllByText('Contribution').length).toBeGreaterThan(1); // card and column
    expect(screen.getByText('31–60 days')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'INV-2026-00001' })).toHaveAttribute('href', '/invoices/inv1');
    expect(screen.getAllByRole('link', { name: 'PO-0001' })[0]).toHaveAttribute('href', '/purchase-orders/po1');
    expect(await screen.findByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/invoices/inv1');
    expect(screen.getByText('slow')).toBeInTheDocument();
  });

  it('leaves out cost columns and cards when the server sends no cost', async () => {
    api.getProductLifecycle.mockResolvedValue(lifecycle({ withCost: false }));
    api.getLifecycleSales.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 });
    render(<ProductLifecycleTab productId="p1" />);
    expect(await screen.findByText('Total received')).toBeInTheDocument();
    expect(screen.queryByText('COGS')).not.toBeInTheDocument();
    expect(screen.queryByText('Card fees')).not.toBeInTheDocument();
    const groups = screen.getByText('Cost groups and receipts').closest('section') as HTMLElement;
    expect(within(groups).queryByText('Unit cost')).not.toBeInTheDocument();
    expect(within(groups).queryByText('Gross profit')).not.toBeInTheDocument();
  });
});
