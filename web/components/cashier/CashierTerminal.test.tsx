import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/cashier',
}));

const PRODUCTS = [
  { variantId: 'v1', productId: 'p1', productName: 'LED Bulb', sku: 'LED-12W', barcode: '6291000000011', sellingPrice: 10, stockQty: 5, unitLabel: 'pcs', attributes: [] },
  { variantId: 'v2', productId: 'p2', productName: 'USB Cable', sku: 'CBL-1', barcode: '6291000000028', sellingPrice: 25, stockQty: 0, unitLabel: 'pcs', attributes: [] },
  { variantId: 'v3', productId: 'p3', productName: 'Smart Plug', sku: 'PLG-1', barcode: '6291000000035', sellingPrice: 100, stockQty: 10, unitLabel: 'pcs', attributes: [], pricingRestriction: { minPrice: null, maxDiscountPercent: 10, maxDiscountAmount: null } },
];

const searchProducts = vi.fn(async (q: string) => {
  const needle = (q || '').toLowerCase();
  if (!needle) return PRODUCTS;
  return PRODUCTS.filter(
    (p) => p.productName.toLowerCase().includes(needle) || p.sku.toLowerCase() === needle || p.barcode === q,
  );
});
vi.mock('@/services/productService', async (orig) => ({
  ...(await orig<any>()),
  searchProducts: (...args: any[]) => searchProducts(...(args as [string])),
  createProduct: vi.fn(),
}));
vi.mock('@/services/categoryService', async (orig) => ({
  ...(await orig<any>()),
  listCategoriesFlat: vi.fn().mockResolvedValue([{ id: 'c1', name: 'Lighting', parentId: null }]),
  listCategoriesTree: vi.fn().mockResolvedValue([]),
}));

const createInvoice = vi.fn();
const updateInvoiceItems = vi.fn();
const addInvoicePayment = vi.fn();
const confirmInvoice = vi.fn();
vi.mock('@/services/invoiceService', async (orig) => ({
  ...(await orig<any>()),
  createInvoice: (...a: any[]) => createInvoice(...a),
  updateInvoiceItems: (...a: any[]) => updateInvoiceItems(...a),
  addInvoicePayment: (...a: any[]) => addInvoicePayment(...a),
  confirmInvoice: (...a: any[]) => confirmInvoice(...a),
  listInvoices: vi.fn().mockResolvedValue({ data: [], meta: {} }),
  getInvoice: vi.fn(),
}));

const createCustomer = vi.fn();
vi.mock('@/services/customerService', async (orig) => ({
  ...(await orig<any>()),
  searchCustomers: vi.fn().mockResolvedValue([]),
  createCustomer: (...a: any[]) => createCustomer(...a),
}));
vi.mock('@/services/printService', () => ({
  printReceipt: vi.fn().mockResolvedValue({ success: true }),
  printInvoice: vi.fn().mockResolvedValue({ success: true }),
}));

import CashierTerminal from './CashierTerminal';
import CashierModePage from '@/app/(cashier)/cashier/page';
import { usePosStore } from '@/store/posStore';
import { useAuthStore } from '@/store/authStore';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import { useInvoiceStore } from '@/store/invoiceStore';

const CASHIER = [
  'invoice.create', 'invoice.view', 'invoice.print', 'product.view',
  'customer.view', 'customer.create', 'customer.view_balance', 'return.request',
];

function setPermissions(permissions: string[]) {
  useAuthStore.setState({ token: 't', user: { id: 'u1', username: 'cashier1', role: 'Cashier' } as any, permissions });
}

const pause = (ms = 60) => act(() => new Promise((r) => setTimeout(r, ms)));
const search = () => screen.getByPlaceholderText('Scan barcode or search products…') as HTMLInputElement;
const cart = () => screen.getByRole('list', { name: 'Cart items' });
const payButton = () => screen.getByRole('button', { name: /^PAY/ });

async function scan(code: string) {
  fireEvent.change(search(), { target: { value: code } });
  fireEvent.keyDown(search(), { key: 'Enter' });
  await pause(10);
}

async function renderTerminal(permissions = CASHIER) {
  setPermissions(permissions);
  render(<CashierTerminal />);
  await screen.findByRole('button', { name: /Add LED Bulb/ });
}

beforeEach(() => {
  sessionStorage.clear();
  usePosStore.getState().clearCart();
  usePosStore.setState({ taxRate: 5 });
  useAppSettingsStore.setState({
    publicSettings: { vat_enabled: true, vat_rate: 5, store_name: 'Test Store', pos_allow_negative_stock: false },
    fetchPublic: vi.fn().mockResolvedValue(null),
  } as any);
  useInvoiceStore.setState({ refreshSummary: vi.fn() } as any);
  router.push.mockReset();
  router.replace.mockReset();
  searchProducts.mockClear();
  createInvoice.mockReset();
  updateInvoiceItems.mockReset();
  addInvoicePayment.mockReset();
  confirmInvoice.mockReset();
  createCustomer.mockReset();
});

afterEach(() => cleanup());

describe('Cashier Mode — access and shell', () => {
  it('renders a full-screen terminal without admin navigation', async () => {
    await renderTerminal();
    expect(search()).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('is gated on the selling permission, not a role name', async () => {
    setPermissions(['product.view']);
    const { container } = render(<CashierModePage />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/dashboard'));
  });
});

describe('Cashier Mode — products, barcode and cart', () => {
  it('a single tap on a product card adds it to the sale', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
    expect(payButton()).toHaveTextContent('PAY AED 10.50');
  });

  it('search box queries the product search endpoint', async () => {
    await renderTerminal();
    fireEvent.change(search(), { target: { value: 'plug' } });
    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith('plug', 60, expect.anything()));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add LED Bulb/ })).toBeNull());
    expect(screen.getByRole('button', { name: /Add Smart Plug/ })).toBeInTheDocument();
  });

  it('BARCODE + ENTER adds the exact match, clears the box, and a repeat scan increments quantity', async () => {
    await renderTerminal();
    await scan('6291000000011');
    expect(search().value).toBe('');
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
    await scan('6291000000011');
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(2);
    expect(screen.getByText('Added LED Bulb · qty 2')).toBeInTheDocument();
  });

  it('unknown barcodes are reported and never add a "closest" product', async () => {
    await renderTerminal();
    await scan('629100');
    await screen.findByText('No product found for “629100”.');
    expect(screen.queryByRole('list', { name: 'Cart items' })).toBeNull();
    // Cashier role lacks product.create → no quick-create shortcut.
    expect(screen.queryByRole('button', { name: 'Create product with this barcode' })).toBeNull();
  });

  it('offers "create product with this barcode" to users who may create products', async () => {
    await renderTerminal([...CASHIER, 'product.create']);
    await scan('999888777');
    fireEvent.click(await screen.findByRole('button', { name: 'Create product with this barcode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Quick add product' });
    expect(within(dialog).getByPlaceholderText(/Scan or type/)).toHaveValue('999888777');
  });

  it('blocks out-of-stock products', async () => {
    await renderTerminal();
    expect(screen.getByRole('button', { name: /Add USB Cable/ })).toBeDisabled();
    await scan('6291000000028');
    expect(await screen.findByText('USB Cable is out of stock.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Cart items' })).toBeNull();
  });

  it('− / + change quantity and removal needs a second confirming tap', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity of LED Bulb' }));
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(2);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of LED Bulb' }));
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove LED Bulb' }));
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removing LED Bulb' }));
    expect(screen.queryByRole('list', { name: 'Cart items' })).toBeNull();
  });
});

describe('Cashier Mode — keyboard', () => {
  it('F2 and / focus search; typing anywhere goes into the search box', async () => {
    await renderTerminal();
    search().blur();
    fireEvent.keyDown(document.body, { key: 'F2' });
    expect(document.activeElement).toBe(search());
    search().blur();
    await pause();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search());
    search().blur();
    await pause();
    fireEvent.keyDown(document.body, { key: 'L' });
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe('L');
  });

  it('F4 opens payment, Escape closes it', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.keyDown(document.body, { key: 'F4' });
    expect(await screen.findByRole('dialog', { name: 'Take payment' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take payment' })).toBeNull());
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
  });

  it('+ / − and double Delete act on the selected line when not typing', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    (document.activeElement as HTMLElement)?.blur();
    await pause();
    fireEvent.keyDown(document.body, { key: '+' });
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(2);
    await pause();
    fireEvent.keyDown(document.body, { key: '-' });
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(1);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(screen.queryByRole('list', { name: 'Cart items' })).toBeNull();
  });

  it('shortcuts never fire while typing in an input', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.keyDown(search(), { key: '-' });
    fireEvent.keyDown(search(), { key: 'Delete' });
    const qty = screen.getByLabelText('Quantity of LED Bulb');
    fireEvent.keyDown(qty, { key: '+' });
    expect(qty).toHaveValue(1);
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
  });

  it('a fast scanner burst typing "-" is treated as barcode text, not a shortcut', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    (document.activeElement as HTMLElement)?.blur();
    await pause();
    fireEvent.keyDown(document.body, { key: 'A' });
    search().blur();
    fireEvent.keyDown(document.body, { key: '-' });
    expect(screen.getByLabelText('Quantity of LED Bulb')).toHaveValue(1);
  });
});

describe('Cashier Mode — quick actions and permissions', () => {
  it('quick-add customer: phone required, save & select keeps the cart', async () => {
    createCustomer.mockResolvedValue({ id: 'c9', name: '0501234567', phone: '0501234567' });
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.keyDown(document.body, { key: 'F6' });
    const dialog = await screen.findByRole('dialog', { name: 'Select customer' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'New customer' }));
    const create = await screen.findByRole('dialog', { name: 'New customer' });
    fireEvent.click(within(create).getByRole('button', { name: 'Save & select' }));
    expect(await within(create).findByText('Phone number is required.')).toBeInTheDocument();
    fireEvent.change(within(create).getByLabelText(/Phone/), { target: { value: '0501234567' } });
    fireEvent.click(within(create).getByRole('button', { name: 'Save & select' }));
    await waitFor(() =>
      expect(createCustomer).toHaveBeenCalledWith({ name: '0501234567', phone: '0501234567', email: null }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(usePosStore.getState().selectedCustomer).toMatchObject({ id: 'c9' });
    expect(within(cart()).getByText('LED Bulb')).toBeInTheDocument();
  });

  it('quick actions are filtered by permission', async () => {
    await renderTerminal();
    fireEvent.keyDown(document.body, { key: 'F9' });
    const menu = await screen.findByRole('dialog', { name: 'Quick actions' });
    expect(within(menu).getByRole('button', { name: /New customer/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /New product/ })).toBeNull();
    expect(within(menu).queryByRole('button', { name: /Custom item/ })).toBeNull();
    cleanup();

    await renderTerminal([...CASHIER, 'product.create', 'invoice.custom_item']);
    fireEvent.keyDown(document.body, { key: 'F9' });
    const full = await screen.findByRole('dialog', { name: 'Quick actions' });
    expect(within(full).getByRole('button', { name: /New product/ })).toBeInTheDocument();
    expect(within(full).getByRole('button', { name: /Custom item/ })).toBeInTheDocument();
  });

  it('discount inputs appear only with invoice.override_price', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add Smart Plug/ }));
    expect(screen.queryByText('Disc %')).toBeNull();
    expect(screen.queryByText('Invoice discount (AED)')).toBeNull();
  });

  it('a pricing-restriction violation is shown and blocks PAY (max discount %)', async () => {
    await renderTerminal([...CASHIER, 'invoice.override_price']);
    fireEvent.click(screen.getByRole('button', { name: /Add Smart Plug/ }));
    const pct = screen.getByText('Disc %').parentElement!.querySelector('input')!;
    fireEvent.change(pct, { target: { value: '20' } });
    expect((await screen.findAllByText(/Maximum allowed discount is 10%\./)).length).toBeGreaterThan(0);
    expect(payButton()).toBeDisabled();
    fireEvent.change(pct, { target: { value: '5' } });
    await waitFor(() => expect(payButton()).toBeEnabled());
  });
});

describe('Cashier Mode — payment, hold and exit', () => {
  it('PAY runs the shared checkout (draft → payment → confirm) and clears the sale', async () => {
    createInvoice.mockResolvedValue({ id: 'inv1', invoiceNumber: 'INV-1' });
    addInvoicePayment.mockResolvedValue({});
    confirmInvoice.mockResolvedValue({
      invoice: { invoiceNumber: 'INV-1', total: 10.5, amountPaid: 10.5, balanceDue: 0 },
      warranties: [],
    });
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.click(payButton());
    const dialog = await screen.findByRole('dialog', { name: 'Take payment' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'AED 20.00' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Complete sale/ }));

    const done = await screen.findByRole('dialog', { name: 'Sale complete' });
    expect(within(done).getByText('AED 9.50')).toBeInTheDocument(); // change due
    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ variantId: 'v1', quantity: 1, unitPrice: 10, discountAmount: 0, serialNumber: null }] }),
    );
    expect(addInvoicePayment).toHaveBeenCalledWith('inv1', expect.objectContaining({ method: 'cash', amount: 10.5 }));
    expect(confirmInvoice).toHaveBeenCalledWith('inv1');
    expect(usePosStore.getState().cart).toHaveLength(0);
  });

  it('a backend rejection keeps the cart and shows the server message', async () => {
    createInvoice.mockRejectedValue({
      code: 'BIZ_PRICING_RESTRICTION_VIOLATION',
      message: 'Price not allowed for LED Bulb. Minimum selling price is AED 12.00.',
    });
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.click(payButton());
    const dialog = await screen.findByRole('dialog', { name: 'Take payment' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Complete sale/ }));
    expect(await within(dialog).findByText(/Minimum selling price is AED 12\.00\./)).toBeInTheDocument();
    expect(usePosStore.getState().cart).toHaveLength(1);
  });

  it('a network failure during payment keeps the cart', async () => {
    createInvoice.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Network unavailable.' });
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.keyDown(document.body, { key: 'F4' });
    const dialog = await screen.findByRole('dialog', { name: 'Take payment' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Complete sale/ }));
    expect(await within(dialog).findByText(/Your cart is kept/)).toBeInTheDocument();
    expect(usePosStore.getState().cart).toHaveLength(1);
  });

  it('F7 holds the sale as a server draft and clears the screen', async () => {
    createInvoice.mockResolvedValue({ id: 'd1', invoiceNumber: 'INV-D1' });
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.keyDown(document.body, { key: 'F7' });
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    expect(addInvoicePayment).not.toHaveBeenCalled();
    expect(confirmInvoice).not.toHaveBeenCalled();
    await waitFor(() => expect(usePosStore.getState().cart).toHaveLength(0));
  });

  it('exit asks before leaving an unfinished sale and never logs out', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: /Add LED Bulb/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Exit Cashier Mode?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay in Cashier Mode' }));
    expect(router.push).not.toHaveBeenCalled();
    expect(usePosStore.getState().cart).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Exit Cashier Mode?' })).getByRole('button', { name: 'Keep sale & exit' }));
    expect(router.push).toHaveBeenCalledWith('/pos');
    expect(usePosStore.getState().cart).toHaveLength(1);
    expect(useAuthStore.getState().token).toBe('t');
  });

  it('exit with an empty cart leaves immediately', async () => {
    await renderTerminal();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(router.push).toHaveBeenCalledWith('/pos');
  });
});
