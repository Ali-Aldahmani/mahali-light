import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { useInvoiceStore } from '@/store/invoiceStore';
import InvoicesPage from './page';

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
});

const mockListInvoices = vi.fn();
const mockExportInvoices = vi.fn();
const mockBulkDelete = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/services/invoiceService', () => ({
  listInvoices: (...args: any[]) => mockListInvoices(...args),
  exportInvoices: (...args: any[]) => mockExportInvoices(...args),
  bulkDeleteInvoices: (...args: any[]) => mockBulkDelete(...args),
}));

// The real menu opens in a Radix portal; plain buttons are enough to test
// what each format sends.
vi.mock('@/components/ui/dropdown-menu', () => ({
  default: ({ label, items }: any) => (
    <div>
      <span>{label}</span>
      {items.map((it: any) => (
        <button key={it.label} type="button" onClick={it.onSelect}>
          {it.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/store/socketStore', () => ({
  onInvoiceEvent: () => () => {},
}));

vi.mock('@/components/invoices/useInvoiceActions', () => ({
  useInvoiceActions: () => ({ actionsFor: () => [], dialogs: null }),
}));

vi.mock('@/components/customers/CustomerHoverName', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

const invoice = (n: number) => ({
  id: `inv-${n}`,
  invoiceNumber: `INV-2026-P79-0000${n}`,
  customerName: 'Guest',
  createdAt: '2026-11-17T22:46:00Z',
  itemCount: 1,
  total: 100,
  amountPaid: 100,
  balanceDue: 0,
  paymentStatus: 'paid',
  status: 'confirmed',
});

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const HEADER = 'Select all invoices on this page';

describe('InvoicesPage - selection', () => {
  beforeEach(() => {
    // Three invoices on this page, 40 matching the filters in total.
    mockListInvoices.mockReset().mockResolvedValue({
      data: [invoice(1), invoice(2), invoice(3)],
      meta: { page: 1, limit: 25, total: 40 },
    });
    mockExportInvoices.mockReset().mockResolvedValue({ filename: 'invoices.csv' });
    mockBulkDelete.mockReset().mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
    useAuthStore.setState({
      permissions: ['invoice.view', 'invoice.download', 'invoice.delete'],
      user: {
        id: 'u1',
        username: 'admin',
        role: 'Admin',
        permissions: ['invoice.view', 'invoice.download'],
      },
      token: 'jwt-token',
    } as any);
    useInvoiceStore.setState({ refreshSummary: vi.fn() } as any);
  });

  it('selects single invoices and shows the count', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    fireEvent.click(box('Select INV-2026-P79-00001'));
    expect(screen.getByText('1 invoice selected')).toBeInTheDocument();
    expect(box(HEADER).indeterminate).toBe(true);

    fireEvent.click(box('Select INV-2026-P79-00002'));
    expect(screen.getByText('2 invoices selected')).toBeInTheDocument();

    fireEvent.click(box('Select INV-2026-P79-00001'));
    expect(screen.getByText('1 invoice selected')).toBeInTheDocument();
  });

  it('header checkbox selects and clears the whole page', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');

    fireEvent.click(box(HEADER));
    expect(screen.getByText('3 invoices selected')).toBeInTheDocument();
    expect(box(HEADER).checked).toBe(true);
    expect(box('Select INV-2026-P79-00003').checked).toBe(true);

    fireEvent.click(box(HEADER));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(box('Select INV-2026-P79-00003').checked).toBe(false);
  });

  it('selects every matching invoice, and unticking one falls back to the page', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');

    fireEvent.click(box(HEADER));
    fireEvent.click(screen.getByText('Select all 40 invoices'));
    expect(screen.getByText('All 40 invoices selected')).toBeInTheDocument();
    expect(screen.queryByText('Select all 40 invoices')).not.toBeInTheDocument();

    fireEvent.click(box('Select INV-2026-P79-00002'));
    expect(screen.getByText('2 invoices selected')).toBeInTheDocument();
    expect(box('Select INV-2026-P79-00002').checked).toBe(false);

    fireEvent.click(screen.getByText('Clear selection'));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('downloads the ticked invoices by id', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');
    expect(screen.queryByText('PDF')).not.toBeInTheDocument();

    fireEvent.click(box('Select INV-2026-P79-00001'));
    fireEvent.click(box('Select INV-2026-P79-00003'));
    fireEvent.click(screen.getByText('Excel'));

    await waitFor(() => expect(mockExportInvoices).toHaveBeenCalledTimes(1));
    expect(mockExportInvoices).toHaveBeenCalledWith('excel', { ids: ['inv-1', 'inv-3'] });
  });

  it('downloads every matching invoice by the current filters', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');

    fireEvent.click(box(HEADER));
    fireEvent.click(screen.getByText('Select all 40 invoices'));
    fireEvent.click(screen.getByText('PDF'));

    await waitFor(() => expect(mockExportInvoices).toHaveBeenCalledTimes(1));
    expect(mockExportInvoices).toHaveBeenCalledWith('pdf', {
      filters: { search: '', status: '', paymentStatus: '', dateFrom: '', dateTo: '' },
    });
  });

  it('hides the download menu without the download permission', async () => {
    useAuthStore.setState({ permissions: ['invoice.view'] } as any);
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');
    fireEvent.click(box('Select INV-2026-P79-00001'));
    expect(screen.getByText('1 invoice selected')).toBeInTheDocument();
    expect(screen.queryByText('CSV')).not.toBeInTheDocument();
  });

  it('bulk-deletes the ticked invoices with a reason', async () => {
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');
    fireEvent.click(box('Select INV-2026-P79-00001'));
    fireEvent.click(box('Select INV-2026-P79-00002'));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(screen.getByText('Delete 2 invoices?')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Delete 2' });
    // A reason is required before the button works.
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for deleting/), {
      target: { value: 'Test sales entered by mistake' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(mockBulkDelete).toHaveBeenCalledTimes(1));
    expect(mockBulkDelete).toHaveBeenCalledWith(
      { ids: ['inv-1', 'inv-2'] },
      'Test sales entered by mistake',
    );
    await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
  });

  it('hides Delete from users without invoice.delete', async () => {
    useAuthStore.setState({ permissions: ['invoice.view', 'invoice.download'] } as any);
    render(<InvoicesPage />);
    await screen.findByText('INV-2026-P79-00001');
    fireEvent.click(box('Select INV-2026-P79-00001'));
    expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument();
  });
});
