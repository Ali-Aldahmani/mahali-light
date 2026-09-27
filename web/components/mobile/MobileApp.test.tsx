import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
let pathname = '/m/dashboard';
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, replace: _r, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const getKPIs = vi.fn();
const getTopProducts = vi.fn();
vi.mock('@/services/analyticsService', () => ({
  getKPIs: (...a: any[]) => getKPIs(...a),
  getTopProducts: (...a: any[]) => getTopProducts(...a),
}));
const getDrawerState = vi.fn();
vi.mock('@/services/cashDrawerService', () => ({ getDrawerState: (...a: any[]) => getDrawerState(...a) }));
const listInvoices = vi.fn();
vi.mock('@/services/invoiceService', () => ({ listInvoices: (...a: any[]) => listInvoices(...a) }));
const getUpcomingBills = vi.fn();
const listBills = vi.fn();
vi.mock('@/services/billService', () => ({
  getUpcomingBills: (...a: any[]) => getUpcomingBills(...a),
  listBills: (...a: any[]) => listBills(...a),
}));
const createProduct = vi.fn();
const lookupProductBarcode = vi.fn();
vi.mock('@/services/productService', () => ({
  createProduct: (...a: any[]) => createProduct(...a),
  lookupProductBarcode: (...a: any[]) => lookupProductBarcode(...a),
}));
const listCategoriesFlat = vi.fn();
vi.mock('@/services/categoryService', () => ({ listCategoriesFlat: (...a: any[]) => listCategoriesFlat(...a) }));
const logout = vi.fn();
const login = vi.fn();
vi.mock('@/services/authService', () => ({
  logout: (...a: any[]) => logout(...a),
  login: (...a: any[]) => login(...a),
}));

import MobileRouteGate from './MobileRouteGate';
import PhoneGate from './PhoneGate';
import MobileDashboard from './screens/MobileDashboard';
import MobileInvoices from './screens/MobileInvoices';
import MobileExpenses from './screens/MobileExpenses';
import MobileTopProducts from './screens/MobileTopProducts';
import MobileAccount from './screens/MobileAccount';
import MobileScanBarcode from './screens/MobileScanBarcode';
import MobileManualBarcode from './screens/MobileManualBarcode';
import MobileProductDetails, { DUPLICATE_BARCODE_MESSAGE, PRODUCT_ADDED_MESSAGE } from './screens/MobileProductDetails';
import { DESKTOP_REQUIRED_MESSAGE, PERMISSION_DENIED_MESSAGE } from './MobileStates';
import LoginPage from '@/app/(auth)/login/page';
import { useAuthStore } from '@/store/authStore';
import { useMobileAddProductStore } from '@/store/mobileAddProductStore';
import { CAMERA_ERROR_MESSAGES } from '@/lib/mobile/scanner';

const OWNER = [
  'analytics.view_dashboard', 'analytics.view', 'cash.view', 'invoice.view', 'bills.view', 'product.create', 'product.view',
];

function signIn(permissions: string[], user: any = { id: 'u1', username: 'admin', role: 'Admin' }) {
  useAuthStore.setState({ token: 't', user, permissions });
}

function setDevice(kind: 'phone' | 'desktop') {
  const [w, h] = kind === 'phone' ? [390, 844] : [1920, 1080];
  Object.defineProperty(window.screen, 'width', { value: w, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: h, configurable: true });
  window.matchMedia = ((q: string) => ({
    matches: kind === 'phone' && q.includes('coarse'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as any;
}

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as any;
  HTMLMediaElement.prototype.pause = vi.fn() as any;
});

beforeEach(() => {
  setDevice('phone');
  pathname = '/m/dashboard';
  signIn(OWNER);
  useMobileAddProductStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noMutationControls = () =>
  expect(screen.queryAllByRole('button', { name: /\b(edit|delete|remove|new|create|add|pay|void|refund)\b/i })).toHaveLength(0);

describe('mobile shell + bottom navigation', () => {
  it('renders the phone shell with the Figma tab bar and the central Add Product action', () => {
    render(<MobileRouteGate><p>content</p></MobileRouteGate>);
    const shell = screen.getByTestId('mobile-shell');
    expect(shell).toHaveClass('overflow-x-hidden');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent || l.getAttribute('aria-label'))).toEqual([
      'Dashboard', 'Invoices', 'Add product', 'Expenses', 'Account',
    ]);
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Add product' })).toHaveAttribute('href', '/m/products/new');
    expect(screen.getByText('content')).toBeInTheDocument();
    // No desktop chrome inside the phone shell.
    expect(screen.queryByText(/Cashier Mode/i)).toBeNull();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('hides Add Product without product.create and degrades to a plain bar', () => {
    signIn(OWNER.filter((p) => p !== 'product.create'));
    render(<MobileRouteGate><p>content</p></MobileRouteGate>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: 'Add product' })).toBeNull();
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
  });

  it('hides tabs the role cannot open', () => {
    signIn(['analytics.view_dashboard']);
    render(<MobileRouteGate><p>content</p></MobileRouteGate>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Dashboard', 'Account']);
  });

  it('shows Permission Denied (not Desktop Required) for a mobile route the role lacks', () => {
    pathname = '/m/invoices';
    signIn(['analytics.view_dashboard']);
    render(<MobileRouteGate><p>secret</p></MobileRouteGate>);
    expect(screen.getByTestId('permission-denied')).toHaveTextContent(PERMISSION_DENIED_MESSAGE);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.queryByText(DESKTOP_REQUIRED_MESSAGE)).toBeNull();
  });

  it('blocks the add-product screens by permission, not just by hiding the button', () => {
    pathname = '/m/products/new/details';
    signIn(['product.view']);
    render(<MobileRouteGate><p>form</p></MobileRouteGate>);
    expect(screen.getByTestId('permission-denied')).toBeInTheDocument();
    expect(screen.queryByText('form')).toBeNull();
  });

  it('sends desktop browsers on /m routes back to the desktop page', () => {
    setDevice('desktop');
    pathname = '/m/invoices';
    const { container } = render(<MobileRouteGate><p>content</p></MobileRouteGate>);
    expect(container).toBeEmptyDOMElement();
    expect(router.replace).toHaveBeenCalledWith('/invoices');
  });
});

describe('phone gate in front of the desktop shells', () => {
  it.each(['/settings', '/users', '/team', '/suppliers', '/reports', '/finance', '/products/p1/edit', '/pos', '/cashier'])(
    'shows Desktop Required on %s',
    (p) => {
      pathname = p;
      render(<PhoneGate><p>desktop ui</p></PhoneGate>);
      expect(screen.getByTestId('desktop-required')).toHaveTextContent('Desktop required');
      expect(screen.getByText(DESKTOP_REQUIRED_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText('desktop ui')).toBeNull();
      expect(screen.queryByText(PERMISSION_DENIED_MESSAGE)).toBeNull();
    },
  );

  it('forwards supported desktop URLs to the mobile screen', () => {
    pathname = '/invoices';
    render(<PhoneGate><p>desktop ui</p></PhoneGate>);
    expect(router.replace).toHaveBeenCalledWith('/m/invoices');
    expect(screen.queryByText('desktop ui')).toBeNull();
  });

  it('leaves desktop untouched', () => {
    setDevice('desktop');
    pathname = '/settings';
    render(<PhoneGate><p>desktop ui</p></PhoneGate>);
    expect(screen.getByText('desktop ui')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('read-only data screens', () => {
  const KPIS = {
    net_profit: 34100, net_margin_pct: 18.5, revenue: 184500, revenue_growth_pct: 12.4,
    invoice_count: 142, receivables_total: 51150, payables_total: 133950,
  };
  const TOP = [
    { product_id: 'p1', variant_id: 'v1', rank: 1, product_name: 'Schneider Acti9 MCB', sku: 'A9F74320', units_sold: 48, revenue: 6240 },
    { product_id: 'p2', variant_id: 'v2', rank: 2, product_name: 'Ducab Cable', sku: 'DUC-3C16', units_sold: 320, revenue: 14400 },
  ];

  it('dashboard shows real API metrics, drawer balance and top products', async () => {
    getKPIs.mockResolvedValue(KPIS);
    getTopProducts.mockResolvedValue(TOP);
    getDrawerState.mockResolvedValue({ status: 'open', currentBalance: 2450 });
    render(<MobileDashboard />);

    expect(await screen.findByText('34,100')).toBeInTheDocument();
    expect(screen.getByText('184,500')).toBeInTheDocument();
    expect(screen.getByText('51,150')).toBeInTheDocument();
    expect(screen.getByText('133,950')).toBeInTheDocument();
    expect(screen.getByText('18.5% margin')).toBeInTheDocument();
    expect(screen.getByText('142 invoices')).toBeInTheDocument();
    expect(screen.getByText('12.4%')).toBeInTheDocument();
    expect(screen.getByText('Welcome back, admin')).toBeInTheDocument();
    expect(await screen.findByLabelText('Cash drawer open: AED 2,450')).toBeInTheDocument();
    expect(await screen.findByText('Schneider Acti9 MCB')).toBeInTheDocument();
    expect(screen.getByText('AED 14,400')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/m/top-products');

    const params = getKPIs.mock.calls[0][0];
    expect(params.start_date).toMatch(/^\d{4}-\d{2}-01$/);
    expect(getTopProducts).toHaveBeenCalledWith(expect.objectContaining({ limit: 3, sort_by: 'revenue' }));
    noMutationControls();
  });

  it('dashboard respects permissions per card and never calls forbidden endpoints', async () => {
    signIn(['invoice.view']);
    render(<MobileDashboard />);
    expect(screen.getAllByText(PERMISSION_DENIED_MESSAGE)).toHaveLength(2);
    expect(getKPIs).not.toHaveBeenCalled();
    expect(getTopProducts).not.toHaveBeenCalled();
    expect(getDrawerState).not.toHaveBeenCalled();
  });

  it('dashboard shows a retryable error state', async () => {
    getKPIs.mockRejectedValueOnce({ code: 'NETWORK_ERROR' }).mockResolvedValueOnce(KPIS);
    getTopProducts.mockResolvedValue([]);
    getDrawerState.mockResolvedValue({ status: 'closed', currentBalance: 0 });
    render(<MobileDashboard />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
    expect(await screen.findByText('No sales in this period.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('34,100')).toBeInTheDocument();
  });

  it('invoices list real rows with payment status and pagination, read-only', async () => {
    listInvoices.mockResolvedValue({
      data: [
        { id: 'i1', invoiceNumber: 'INV-2025-0089', total: 5460, balanceDue: 3460, paymentStatus: 'partial' },
        { id: 'i2', invoiceNumber: 'INV-2025-0088', total: 1312.5, balanceDue: 0, paymentStatus: 'paid' },
      ],
      meta: { page: 1, limit: 10, total: 2 },
    });
    render(<MobileInvoices />);
    expect(await screen.findByText('INV-2025-0089')).toBeInTheDocument();
    expect(screen.getByText('AED 1,312.5')).toBeInTheDocument();
    expect(screen.getByText('AED 0')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(listInvoices).toHaveBeenCalledWith({ page: 1, limit: 10 });

    fireEvent.click(screen.getByRole('button', { name: /^Total/ }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('INV-2025-0088');
    noMutationControls();
  });

  it('invoices show empty and error states', async () => {
    listInvoices.mockResolvedValueOnce({ data: [], meta: { total: 0 } });
    render(<MobileInvoices />);
    expect(await screen.findByText('No invoices yet')).toBeInTheDocument();
    cleanup();
    listInvoices.mockRejectedValueOnce({ message: 'Boom' });
    render(<MobileInvoices />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('expenses show the bills summary and active bills, read-only', async () => {
    getUpcomingBills.mockResolvedValue({
      totals: { monthlyRecurringTotal: 2339, overdueAmount: 15580.95, dueThisWeekAmount: 0, paidThisMonth: 0 },
      buckets: { overdue: [{}, {}, {}], dueToday: [], thisWeek: [] },
    });
    listBills.mockResolvedValue({
      data: [{ id: 'b1', name: 'DEWA', categoryIcon: '💡', amount: 1840, nextDueDate: '2025-09-05', daysUntilDue: -3 }],
    });
    render(<MobileExpenses />);
    expect(await screen.findByText('AED 2339.00')).toBeInTheDocument();
    expect(screen.getByText('AED 15580.95')).toBeInTheDocument();
    expect(screen.getByText('3 payment(s)')).toBeInTheDocument();
    expect(await screen.findByText('DEWA')).toBeInTheDocument();
    expect(screen.getByText('AED 1840.00')).toBeInTheDocument();
    expect(screen.getByText('Overdue', { selector: 'span' })).toBeInTheDocument();
    expect(listBills).toHaveBeenCalledWith({ status: 'active' });
    noMutationControls();
  });

  it('top products page lists ranked products', async () => {
    getTopProducts.mockResolvedValue(TOP);
    render(<MobileTopProducts />);
    expect(await screen.findByText('Ducab Cable')).toBeInTheDocument();
    expect(screen.getByText('SKU A9F74320')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(getTopProducts).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, sort_by: 'revenue' }));
  });
});

describe('auth on mobile', () => {
  it('account shows the user and logs out through the existing auth service', async () => {
    logout.mockResolvedValue(undefined);
    render(<MobileAccount />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Log out/ }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('phones get the Figma login, backed by the same login call', async () => {
    useAuthStore.setState({ token: null, user: null, permissions: [] });
    login.mockResolvedValue({});
    render(<LoginPage />);
    expect(screen.getByTestId('mobile-login')).toBeInTheDocument();
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByText('Username is required.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'secret' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/m/dashboard'));
  });

  it('desktop keeps the existing login screen', () => {
    setDevice('desktop');
    useAuthStore.setState({ token: null, user: null, permissions: [] });
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-login')).toBeNull();
  });
});

function fakeCamera() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { track, mediaDevices: { getUserMedia: vi.fn(async () => stream) } };
}

describe('add product: camera scan', () => {
  it('scans once, releases the camera and opens Product details with the code', async () => {
    const cam = fakeCamera();
    const detector = { detect: vi.fn(async () => [{ rawValue: '6291007029871' }]) };
    render(
      <MobileScanBarcode
        scannerDeps={{ mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1 }}
      />,
    );
    expect(screen.getByTestId('scan-frame')).toBeInTheDocument();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/m/products/new/details'));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(cam.track.stop).toHaveBeenCalled();
    expect(useMobileAddProductStore.getState()).toMatchObject({ barcode: '6291007029871', source: 'camera' });
  });

  it('keeps scanning without an error while no barcode is found, and frees the camera on leave', async () => {
    const cam = fakeCamera();
    const detector = { detect: vi.fn(async () => []) };
    const { unmount } = render(
      <MobileScanBarcode
        scannerDeps={{ mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1 }}
      />,
    );
    await waitFor(() => expect(detector.detect.mock.calls.length).toBeGreaterThan(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Enter barcode manually' })).toHaveAttribute('href', '/m/products/new/manual');
    expect(cam.track.stop).not.toHaveBeenCalled();
    unmount();
    expect(cam.track.stop).toHaveBeenCalled();
  });

  it('pauses the camera when the tab is hidden', async () => {
    const cam = fakeCamera();
    const detector = { detect: vi.fn(async () => []) };
    render(
      <MobileScanBarcode
        scannerDeps={{ mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1 }}
      />,
    );
    await waitFor(() => expect(detector.detect).toHaveBeenCalled());
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(cam.track.stop).toHaveBeenCalled();
    expect(screen.getByText('Camera paused')).toBeInTheDocument();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it.each([
    ['permission-denied', Object.assign(new Error('x'), { name: 'NotAllowedError' })],
    ['unavailable', Object.assign(new Error('x'), { name: 'NotFoundError' })],
  ] as const)('explains %s and keeps the manual option', async (kind, err) => {
    const cam = fakeCamera();
    cam.mediaDevices.getUserMedia.mockRejectedValueOnce(err);
    render(
      <MobileScanBarcode
        scannerDeps={{ mediaDevices: cam.mediaDevices, createDetector: async () => ({ detect: vi.fn() }), isSecureContext: true }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_MESSAGES[kind]);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter barcode manually' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('explains unsupported browsers', async () => {
    render(
      <MobileScanBarcode scannerDeps={{ mediaDevices: fakeCamera().mediaDevices, createDetector: async () => null, isSecureContext: true }} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Barcode scanning is not supported on this browser. Enter the barcode manually.',
    );
  });
});

describe('add product: manual entry', () => {
  it('rejects invalid codes and forwards valid ones into the same details flow', () => {
    render(<MobileManualBarcode />);
    const input = screen.getByLabelText('Barcode number');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '4006381333932' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/not valid/);
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '12a34' } });
    expect(input).toHaveValue('1234');

    fireEvent.change(input, { target: { value: '96385074' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/m/products/new/details');
    expect(useMobileAddProductStore.getState()).toMatchObject({ barcode: '96385074', source: 'manual' });
  });
});

describe('add product: details + save', () => {
  const CATS = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Drinks', path: 'Food > Drinks' },
  ];

  beforeEach(() => {
    listCategoriesFlat.mockResolvedValue(CATS);
    lookupProductBarcode.mockResolvedValue({ source: 'not_found', internal: null, external: null });
  });

  async function fill() {
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Cola 330ml' } });
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '4.50' } });
    fireEvent.change(screen.getByLabelText('Initial quantity'), { target: { value: '24' } });
    await screen.findByRole('option', { name: 'Food > Drinks' });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: CATS[0].id } });
  }

  it.each([
    ['camera', 'Barcode scanned successfully'],
    ['manual', 'Barcode entered manually'],
  ] as const)('%s path converges on one creation form and saves via POST /products', async (source, banner) => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', source);
    createProduct.mockResolvedValue({ id: 'p9', name: 'Cola 330ml' });
    render(<MobileProductDetails />);
    expect(screen.getByText(banner)).toBeInTheDocument();
    expect(screen.getByTestId('details-barcode')).toHaveTextContent('6291007029871');
    expect(screen.getByText('You can add advanced information later from the desktop.')).toBeInTheDocument();
    await waitFor(() => expect(lookupProductBarcode).toHaveBeenCalledWith('6291007029871'));
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));

    expect(await screen.findByText(PRODUCT_ADDED_MESSAGE)).toBeInTheDocument();
    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(createProduct).toHaveBeenCalledWith({
      name: 'Cola 330ml',
      categoryId: CATS[0].id,
      hasVariants: false,
      soldBy: 'piece',
      unitLabel: 'pcs',
      isActive: true,
      simple: { sellingPrice: 4.5, openingStock: 24, barcode: '6291007029871', sku: null, supplierBarcode: null },
    });
    expect(useMobileAddProductStore.getState().barcode).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
    expect(router.replace).toHaveBeenCalledWith('/m/dashboard');
  });

  it('validates required fields before calling the API', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'camera');
    render(<MobileProductDetails />);
    await waitFor(() => expect(lookupProductBarcode).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Product name is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter the selling price.')).toBeInTheDocument();
    expect(screen.getByText('Choose a category.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '4.555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Enter a valid price, e.g. 4.50.')).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('keeps the form and allows retry when saving fails', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'camera');
    createProduct.mockRejectedValueOnce({ code: 'NETWORK_ERROR' }).mockResolvedValueOnce({ id: 'p9', name: 'Cola 330ml' });
    render(<MobileProductDetails />);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText(/Your details are kept/)).toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toHaveValue('Cola 330ml');
    expect(screen.getByLabelText('Selling price')).toHaveValue('4.50');
    expect(screen.getByLabelText('Initial quantity')).toHaveValue('24');
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText(PRODUCT_ADDED_MESSAGE)).toBeInTheDocument();
    expect(createProduct).toHaveBeenCalledTimes(2);
  });

  it('surfaces a server 403 as a permission error', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'camera');
    createProduct.mockRejectedValueOnce({ status: 403, code: 'AUTH_NO_PERMISSION', message: 'nope' });
    render(<MobileProductDetails />);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText(PERMISSION_DENIED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(PRODUCT_ADDED_MESSAGE)).toBeNull();
  });

  it('blocks a barcode that already belongs to a product (lookup)', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'manual');
    lookupProductBarcode.mockResolvedValueOnce({
      source: 'internal',
      internal: { product_id: 1, variant_id: 2, product_name: 'Existing Cola', sku: 'COL-1' },
      external: null,
    });
    render(<MobileProductDetails />);
    expect(await screen.findByText(DUPLICATE_BARCODE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('Existing Cola')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    expect(createProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Scan another barcode' }));
    expect(router.replace).toHaveBeenCalledWith('/m/products/new');
  });

  it('maps a 409 from the create API to the duplicate message', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'camera');
    createProduct.mockRejectedValueOnce({ status: 409, details: { field: 'barcode' }, message: 'Barcode in use' });
    render(<MobileProductDetails />);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText(DUPLICATE_BARCODE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toHaveValue('Cola 330ml');
  });

  it('prefills the name from the external barcode database', async () => {
    useMobileAddProductStore.getState().setBarcode('6291007029871', 'camera');
    lookupProductBarcode.mockResolvedValueOnce({
      source: 'external', internal: null, external: { name: 'Coca-Cola Original Taste 330ml' },
    });
    render(<MobileProductDetails />);
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveValue('Coca-Cola Original Taste 330ml'));
  });

  it('restarts the flow when opened without a barcode', () => {
    render(<MobileProductDetails />);
    expect(router.replace).toHaveBeenCalledWith('/m/products/new');
  });
});
