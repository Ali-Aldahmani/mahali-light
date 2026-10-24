'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Edit3,
  Phone,
  Mail,
  MapPin,
  Building2,
  Calendar,
  TrendingUp,
  Wallet,
  Receipt,
  ShieldCheck,
  History,
  Banknote,
  CreditCard,
  RefreshCw,
  FileText,
  CalendarDays,
  Edit,
  Shield,
  Undo2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import Skeleton from '@/components/ui/skeleton';
import Table, { type TableColumn } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import CustomerAvatar from '@/components/ui/CustomerAvatar';
import OutstandingBalanceCard from '@/components/ui/OutstandingBalanceCard';
import PaymentMethodIcon from '@/components/ui/PaymentMethodIcon';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import InvoiceStatusBadge from '@/components/ui/InvoiceStatusBadge';
import WarrantyCard from '@/components/ui/WarrantyCard';
import RequirePermission from '@/components/guards/RequirePermission';
import CustomerFormSlideOver, {
  type CustomerRecord,
} from '@/components/customers/CustomerFormSlideOver';
import CollectPaymentSlideOver from '@/components/customers/CollectPaymentSlideOver';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import {
  getCustomer,
  getCustomerPayments,
  getCustomerInvoices,
  getCustomerReturns,
  getCustomerWarranties,
  getCustomerTimeline,
} from '@/services/customerService';
import { voidPayment } from '@/services/customerPaymentService';
import { formatCurrency, formatDate, formatDateTime, storeDate } from '@/lib/utils/format';
import { onCustomerBalanceUpdate, onCustomerChanged } from '@/store/socketStore';
import RowActions from '@/components/ui/RowActions';
import { viewColumn } from '@/components/ui/viewColumn';

interface CustomerProfile extends CustomerRecord {
  /** Net: grossSpent - refundedTotal. */
  totalSpent?: number;
  grossSpent?: number;
  refundedTotal?: number;
  creditBalance?: number;
  lastPurchaseDate?: string | null;
  lastPurchaseAt?: string | null;
  lastPaymentDate?: string | null;
  lastPaymentAt?: string | null;
  invoiceCount?: number;
  avgOrderValue?: number;
  createdAt?: string;
  createdByUsername?: string | null;
}

interface InvoiceRow {
  id: number | string;
  invoiceNumber: string;
  createdAt: string;
  confirmedAt?: string | null;
  status: string;
  itemCount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
}

interface PaymentRow {
  id: number | string;
  paymentDate?: string;
  createdAt: string;
  amount: number;
  paymentMethod: string;
  employeeUsername?: string;
  notes?: string;
  /** balance = collection against the outstanding balance; invoice = paid at checkout. */
  source?: 'balance' | 'invoice';
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  voidedAt?: string | null;
  voidedByUsername?: string | null;
}

interface ReturnRequestRow {
  id: number | string;
  requestNumber: string;
  returnType?: string;
  itemCount: number;
  totalValue: number;
  invoiceNumber?: string;
  noInvoiceReturn?: boolean;
  status: string;
  requestedAt: string;
  refundTotal?: number | null;
}

interface ReturnsData {
  items: ReturnRequestRow[];
  stats?: {
    totalSpent?: number;
    totalReturned?: number;
    totalRefunded?: number;
    returnRate?: number;
  };
}

interface WarrantyRow {
  id: number | string;
  [key: string]: unknown;
}

interface TimelineEvent {
  event: string;
  referenceId?: string | number;
  at: string;
  label?: string;
  amount?: number | null;
  employeeUsername?: string;
  status?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

const TABS = [
  { value: 'invoices', label: 'Invoices', icon: <Receipt className="h-4 w-4" /> },
  { value: 'payments', label: 'Payments', icon: <Banknote className="h-4 w-4" /> },
  { value: 'returns', label: 'Returns', icon: <RefreshCw className="h-4 w-4" /> },
  {
    value: 'warranties',
    label: 'Warranties',
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  { value: 'timeline', label: 'Timeline', icon: <History className="h-4 w-4" /> },
];

function CustomerProfilePageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'invoices';

  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('customer.edit');
  const canCollect = permissions.includes('customer.collect_payment');
  const canSeeBalance = permissions.includes('customer.view_balance');

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  // Bumped whenever the customer changes anywhere, so open tabs refetch too.
  const [refreshKey, setRefreshKey] = useState(0);

  // The first load shows the skeleton; later refreshes (live updates, after
  // a save) swap the data in place so an open form and the scroll position
  // survive.
  async function loadCustomer({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      setCustomer(await getCustomer(id));
    } catch (err: any) {
      if (silent) return;
      toast.error(err?.message || 'Customer not found.');
      router.push('/customers');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function refreshAll() {
    loadCustomer({ silent: true });
    setRefreshKey((k) => k + 1);
  }
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;

  useEffect(() => {
    loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Changes made on other terminals: profile edits, payments, invoices,
  // returns. After a reconnect, or when the window comes back into view,
  // refetch in case events were missed meanwhile.
  useEffect(() => {
    const offBalance = onCustomerBalanceUpdate((evt: any) => {
      if (evt?.customerId === id) refreshRef.current();
    });
    const offChanged = onCustomerChanged((evt: any) => {
      if (evt?.reconnected || evt?.customerId === id) refreshRef.current();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offBalance();
      offChanged();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);

  if (loading || !customer) {
    return (
      <div className="py-4">
        <Skeleton lines={6} avatar />
      </div>
    );
  }

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => router.push('/customers')}
      >
        All customers
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <CustomerAvatar customer={customer} size="lg" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink leading-tight tracking-tight truncate">
              {customer.name}
            </h1>
            <p className="mt-1 text-sm text-ink-muted truncate">
              {customer.companyName || customer.phone || 'Walk-in customer'}
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              leftIcon={<Edit3 className="h-4 w-4" />}
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
          )}
          {canCollect && Number(customer.creditBalance || 0) > 0 && (
            <Button
              leftIcon={<CreditCard className="h-4 w-4" />}
              onClick={() => setPayOpen(true)}
            >
              Collect payment
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ContactCard customer={customer} />
        {canSeeBalance ? (
          <OutstandingBalanceCard
            balance={customer.creditBalance}
            limit={customer.creditLimit}
            canCollect={canCollect && Number(customer.creditBalance || 0) > 0}
            onCollect={() => setPayOpen(true)}
          />
        ) : (
          <div className="rounded-card border border-border bg-surface-2 p-4 text-sm text-ink-muted">
            Balance hidden by permissions.
          </div>
        )}
        <CreditCardInfo customer={customer} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total spent"
          value={formatCurrency(customer.totalSpent || 0)}
          hint={
            Number(customer.refundedTotal || 0) > 0
              ? `${formatCurrency(customer.grossSpent || 0)} sales − ${formatCurrency(customer.refundedTotal || 0)} refunds`
              : 'Confirmed sales, net of refunds'
          }
        />
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="Outstanding balance"
          value={
            canSeeBalance ? formatCurrency(customer.creditBalance || 0) : '—'
          }
          tone={(customer.creditBalance || 0) > 0 ? 'warning' : 'default'}
          hint="Owed by the customer"
        />
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Last purchase"
          value={
            customer.lastPurchaseAt || customer.lastPurchaseDate
              ? formatDateTime(customer.lastPurchaseAt || customer.lastPurchaseDate)
              : '—'
          }
        />
        <StatCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Last payment"
          value={
            customer.lastPaymentAt || customer.lastPaymentDate
              ? formatDateTime(customer.lastPaymentAt || customer.lastPaymentDate)
              : '—'
          }
        />
        <StatCard
          icon={<Receipt className="h-4 w-4" />}
          label="Invoices"
          value={customer.invoiceCount || 0}
          hint="Confirmed sales"
        />
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Avg order value"
          value={formatCurrency(customer.avgOrderValue || 0)}
          hint="Net spent ÷ invoices"
        />
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'invoices' && <InvoicesTab customerId={id} refreshKey={refreshKey} />}
      {tab === 'payments' && (
        <PaymentsTab
          customerId={id}
          canCollect={canCollect}
          customer={customer}
          onChanged={refreshAll}
          openPay={() => setPayOpen(true)}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'returns' && <ReturnsTab customerId={id} refreshKey={refreshKey} />}
      {tab === 'warranties' && <WarrantiesTab customerId={id} refreshKey={refreshKey} />}
      {tab === 'timeline' && <TimelineTab customerId={id} refreshKey={refreshKey} />}

      <CustomerFormSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
        onSaved={refreshAll}
      />

      <CollectPaymentSlideOver
        open={payOpen}
        onClose={() => setPayOpen(false)}
        customer={customer}
        onCollected={refreshAll}
      />
    </div>
  );
}

function ContactCard({ customer }: { customer: CustomerProfile }) {
  const lines = [
    customer.phone && { icon: <Phone className="h-4 w-4" />, value: customer.phone },
    customer.email && { icon: <Mail className="h-4 w-4" />, value: customer.email },
    customer.address && { icon: <MapPin className="h-4 w-4" />, value: customer.address },
    customer.companyName && {
      icon: <Building2 className="h-4 w-4" />,
      value: customer.companyName,
    },
  ].filter(Boolean) as { icon: React.ReactNode; value: string }[];

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="text-xs text-ink-muted mb-2">Contact</div>
      {lines.length === 0 && (
        <div className="text-sm text-ink-muted">No contact info on file.</div>
      )}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-ink">
            <span className="text-ink-muted">{l.icon}</span>
            <span className="truncate">{l.value}</span>
          </div>
        ))}
      </div>
      {customer.trnNumber && (
        <div className="mt-3 pt-3 border-t border-border text-xs text-ink-muted">
          <div>TRN</div>
          <div className="font-mono text-sm text-ink mt-0.5">
            {customer.trnNumber}
          </div>
        </div>
      )}
    </div>
  );
}

function CreditCardInfo({ customer }: { customer: CustomerProfile }) {
  const limit = Number(customer.creditLimit || 0);
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="text-xs text-ink-muted mb-2">Credit terms</div>
      <div className="space-y-2 text-sm text-ink">
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">Credit limit</span>
          <span className="font-medium">
            {limit > 0 ? formatCurrency(limit) : 'No limit'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">Status</span>
          <Badge tone={customer.isActive ? 'success' : 'muted'} size="sm" dot>
            {customer.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">Customer since</span>
          <span>{formatDate(customer.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">Created by</span>
          <span>{customer.createdByUsername || '—'}</span>
        </div>
      </div>
      {customer.notes && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-xs text-ink-muted mb-1">Notes</div>
          <div className="text-sm text-ink whitespace-pre-line">
            {customer.notes}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  /** What the number means, shown small under it. */
  hint?: string;
  tone?: 'default' | 'warning' | 'success';
}) {
  const TONES: Record<string, string> = {
    default: 'bg-surface-2 text-ink-muted',
    warning: 'bg-warning-light text-warning',
    success: 'bg-success-light text-success',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <div className="flex items-center gap-2">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${TONES[tone]}`}>
          {icon}
        </div>
        <div className="text-xs text-ink-muted">{label}</div>
      </div>
      <div className="text-base font-semibold text-ink mt-1.5 truncate">
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-ink-muted mt-0.5 truncate" title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}

// Tabs --------------------------------------------------------------------

function InvoicesTab({ customerId, refreshKey }: { customerId: string; refreshKey: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerInvoices(customerId)
      .then((data: InvoiceRow[]) => {
        if (!cancelled) setRows(data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, refreshKey]);

  const columns: TableColumn[] = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r: InvoiceRow) => (
        <button
          type="button"
          onClick={() => router.push(`/invoices/${r.id}`)}
          className="font-mono text-sm text-ink hover:text-accent"
        >
          {r.invoiceNumber}
        </button>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (r: InvoiceRow) => (
        <span className="text-xs text-ink-muted">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      align: 'right' as const,
      render: (r: InvoiceRow) => r.itemCount,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right' as const,
      render: (r: InvoiceRow) => formatCurrency(r.total),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right' as const,
      render: (r: InvoiceRow) => formatCurrency(r.amountPaid),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right' as const,
      render: (r: InvoiceRow) =>
        r.balanceDue > 0 ? (
          <span className="text-accent font-medium">
            {formatCurrency(r.balanceDue)}
          </span>
        ) : (
          formatCurrency(r.balanceDue)
        ),
    },
    {
      key: 'status',
      header: 'Invoice',
      render: (r: InvoiceRow) => <InvoiceStatusBadge status={r.status} size="sm" />,
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (r: InvoiceRow) => (
        <PaymentStatusBadge status={r.paymentStatus} size="sm" />
      ),
    },
  ];

  if (loading) {
    return (
      <div className="py-4">
        <Skeleton lines={4} />
      </div>
    );
  }

  return (
    <Table
      columns={[...columns, viewColumn<InvoiceRow>({ label: 'Invoice actions', onView: (r) => router.push(`/invoices/${r.id}`) })]}
      rows={rows}
      rowKey={(r: InvoiceRow) => r.id}
      empty={
        <EmptyState
          title="No invoices yet"
          description="This customer has no invoices recorded."
          icon={<Receipt className="h-6 w-6" />}
        />
      }
    />
  );
}

function PaymentsTab({
  customerId,
  canCollect,
  customer,
  onChanged,
  openPay,
  refreshKey,
}: {
  customerId: string;
  canCollect: boolean;
  customer: CustomerProfile;
  onChanged?: () => void;
  openPay: () => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<{ rows: PaymentRow[]; total: number; checkout: number }>({
    rows: [],
    total: 0,
    checkout: 0,
  });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getCustomerPayments(customerId);
      setData({
        rows: res?.data || [],
        total: res?.meta?.totals?.totalCollected || 0,
        checkout: res?.meta?.totals?.totalCheckout || 0,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, refreshKey]);

  // Returns whether the payment was voided (drives the row action's confirmation).
  async function handleVoid(p: PaymentRow): Promise<boolean> {
    if (!confirm('Reverse this payment? Same-day payments only.')) return false;
    try {
      await voidPayment(p.id);
      toast.success('Payment voided.');
      await load();
      onChanged?.();
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'Could not void payment.');
      return false;
    }
  }

  const today = storeDate();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-muted flex flex-wrap gap-x-4">
          <span>
            Paid at checkout:{' '}
            <span className="font-medium text-ink">{formatCurrency(data.checkout)}</span>
          </span>
          <span>
            Collected on balance:{' '}
            <span className="font-medium text-ink">{formatCurrency(data.total)}</span>
          </span>
        </div>
        {canCollect && Number(customer.creditBalance || 0) > 0 && (
          <Button
            size="sm"
            leftIcon={<CreditCard className="h-4 w-4" />}
            onClick={openPay}
          >
            Collect payment
          </Button>
        )}
      </div>
      <Table
        columns={[
          {
            key: 'date',
            header: 'Date',
            render: (r: PaymentRow) => (
              <div>
                <div>{formatDate(r.paymentDate || r.createdAt)}</div>
                {/* Business date above; when it was actually recorded below. */}
                <div className="text-xs text-ink-muted">{formatDateTime(r.createdAt)}</div>
              </div>
            ),
          },
          {
            key: 'source',
            header: 'Type',
            render: (r: PaymentRow) =>
              r.source === 'invoice' && r.invoiceId ? (
                <Link
                  href={`/invoices/${r.invoiceId}`}
                  className="text-sm text-accent hover:underline"
                >
                  Checkout · <span className="font-mono text-xs">{r.invoiceNumber}</span>
                </Link>
              ) : (
                <span className="text-sm">Balance payment</span>
              ),
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right' as const,
            render: (r: PaymentRow) => (
              <span className={r.voidedAt ? 'text-ink-muted line-through' : 'font-medium text-ink'}>
                {formatCurrency(r.amount)}
              </span>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            render: (r: PaymentRow) =>
              r.voidedAt ? (
                <Badge size="sm" tone="error">
                  Voided {formatDateTime(r.voidedAt)}
                  {r.voidedByUsername ? ` by ${r.voidedByUsername}` : ''}
                </Badge>
              ) : (
                <Badge size="sm" tone="success">
                  Received
                </Badge>
              ),
          },
          {
            key: 'method',
            header: 'Method',
            render: (r: PaymentRow) => <PaymentMethodIcon method={r.paymentMethod} />,
          },
          {
            key: 'employee',
            header: 'Collected by',
            render: (r: PaymentRow) => r.employeeUsername || '—',
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (r: PaymentRow) => (
              <span className="text-xs text-ink-muted">{r.notes || '—'}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            sortable: false,
            render: (r: PaymentRow) => (
              <RowActions
                label="Payment actions"
                actions={[
                  {
                    id: 'void',
                    label: 'Void',
                    icon: <Undo2 />,
                    tone: 'danger',
                    doneLabel: 'Voided',
                    // Same-day balance payments only; checkout payments are
                    // reversed by cancelling the invoice.
                    hidden:
                      !canCollect ||
                      r.source === 'invoice' ||
                      !!r.voidedAt ||
                      storeDate(r.createdAt) !== today,
                    onClick: () => handleVoid(r),
                  },
                ]}
              />
            ),
          },
        ]}
        rows={data.rows}
        rowKey={(r: PaymentRow) => `${r.source || 'balance'}:${r.id}`}
        loading={loading}
        empty={
          <EmptyState
            title="No payments yet"
            description="Checkout payments and balance collections from this customer will appear here."
            icon={<Banknote className="h-6 w-6" />}
          />
        }
      />
    </div>
  );
}

function ReturnsTab({ customerId, refreshKey }: { customerId: string; refreshKey: number }) {
  const [data, setData] = useState<ReturnsData>({ items: [], stats: undefined });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerReturns(customerId)
      .then((r: ReturnsData) => setData(r || { items: [], stats: undefined }))
      .catch(() => setData({ items: [], stats: undefined }))
      .finally(() => setLoading(false));
  }, [customerId, refreshKey]);

  if (loading) {
    return (
      <div className="py-4">
        <Skeleton lines={4} />
      </div>
    );
  }

  const items = data.items || [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No returns yet"
        description="When this customer returns or replaces purchased items, you'll see them here."
        icon={<RefreshCw className="h-6 w-6" />}
      />
    );
  }

  const stats = data.stats || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-muted">Confirmed sales</div>
          <div className="text-xl font-semibold text-ink mt-1">
            {formatCurrency(stats.totalSpent || 0)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-muted">Returned value</div>
          <div className="text-xl font-semibold text-warning mt-1">
            {formatCurrency(stats.totalReturned || 0)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {formatCurrency(stats.totalRefunded || 0)} refunded
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-ink-muted">Return rate</div>
          <div className="text-xl font-semibold text-ink mt-1">
            {Number(stats.returnRate || 0).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-2">Request</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Items</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2">Refunded</th>
              <th className="px-4 py-2">Invoice</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link
                    href={`/returns/requests/${r.id}`}
                    className="font-mono text-xs text-accent hover:underline"
                  >
                    {r.requestNumber}
                  </Link>
                </td>
                <td className="px-4 py-2 capitalize">
                  {(r.returnType || '').replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-2">{r.itemCount}</td>
                <td className="px-4 py-2">{formatCurrency(r.totalValue)}</td>
                <td className="px-4 py-2">
                  {r.refundTotal != null ? formatCurrency(r.refundTotal) : '—'}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {r.invoiceNumber || (r.noInvoiceReturn ? '— (no invoice)' : '—')}
                </td>
                <td className="px-4 py-2 capitalize">{r.status}</td>
                <td className="px-4 py-2 text-xs text-ink-muted">
                  {formatDateTime(r.requestedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WarrantiesTab({ customerId, refreshKey }: { customerId: string; refreshKey: number }) {
  const [rows, setRows] = useState<WarrantyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerWarranties(customerId)
      .then((r: WarrantyRow[]) => setRows(r || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [customerId, refreshKey]);

  if (loading) {
    return (
      <div className="py-4">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        title="No warranties on file"
        description="Warranties are created automatically the moment a sale is confirmed."
        icon={<ShieldCheck className="h-6 w-6" />}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((w) => (
        <WarrantyCard key={w.id} warranty={w} />
      ))}
    </div>
  );
}

const EVENT_META: Record<string, { label: string; Icon: any; tone: string }> = {
  invoice_created: {
    label: 'Draft invoice created',
    Icon: Receipt,
    tone: 'text-ink-muted bg-surface-2',
  },
  invoice_confirmed: {
    label: 'Sale confirmed',
    Icon: Receipt,
    tone: 'text-accent bg-accent-light',
  },
  invoice_cancelled: {
    label: 'Invoice cancelled',
    Icon: Receipt,
    tone: 'text-error bg-error-light',
  },
  payment_collected: {
    label: 'Payment collected',
    Icon: Banknote,
    tone: 'text-success bg-success-light',
  },
  payment_voided: {
    label: 'Payment voided',
    Icon: Undo2,
    tone: 'text-error bg-error-light',
  },
  return_processed: {
    label: 'Return processed',
    Icon: RefreshCw,
    tone: 'text-warning bg-warning-light',
  },
  warranty_created: {
    label: 'Warranty created',
    Icon: ShieldCheck,
    tone: 'text-success bg-success-light',
  },
  profile_updated: {
    label: 'Profile updated',
    Icon: Edit,
    tone: 'text-ink-muted bg-surface-2',
  },
};

// Audit action -> heading for profile events.
const PROFILE_ACTION_LABELS: Record<string, string> = {
  'customer.created': 'Customer created',
  'customer.updated': 'Profile updated',
  'customer.credit_limit_updated': 'Credit limit changed',
  'customer.status_changed': 'Status changed',
  'customer.deleted': 'Customer deactivated',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  companyName: 'Company',
  trnNumber: 'TRN',
  creditLimit: 'Credit limit',
  notes: 'Notes',
  isActive: 'Status',
};

function showValue(key: string, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'isActive') return v ? 'Active' : 'Inactive';
  if (key === 'creditLimit') return Number(v) > 0 ? formatCurrency(Number(v)) : 'No limit';
  return String(v);
}

// "Phone: 050… → 055…" lines for an audit entry that carries old/new values.
function ChangeList({ evt }: { evt: TimelineEvent }) {
  const before = evt.oldValue || {};
  const after = evt.newValue || {};
  const keys = Object.keys(after).filter((k) => k in FIELD_LABELS);
  if (!keys.length) return null;
  const created = evt.status === 'customer.created';
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
      {keys.map((k) => (
        <li key={k} className="truncate">
          <span className="text-ink">{FIELD_LABELS[k]}:</span>{' '}
          {created ? (
            showValue(k, after[k])
          ) : (
            <>
              {showValue(k, before[k])} → <span className="text-ink">{showValue(k, after[k])}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function TimelineTab({ customerId, refreshKey }: { customerId: string; refreshKey: number }) {
  const [items, setItems] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCustomerTimeline(customerId)
      .then((res) => {
        if (cancelled) return;
        setItems(res?.data || []);
        setCursor(res?.meta?.nextCursor || null);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Could not load the timeline.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, refreshKey, attempt]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await getCustomerTimeline(customerId, { before: cursor });
      setItems((prev) => [...prev, ...(res?.data || [])]);
      setCursor(res?.meta?.nextCursor || null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not load more activity.');
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="py-4">
        <Skeleton lines={4} />
      </div>
    );
  }

  // A failed load must not look like an empty history.
  if (error) {
    return (
      <EmptyState
        title="Timeline didn't load"
        description={error}
        icon={<History className="h-6 w-6" />}
        action={
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Invoices, payments, returns and profile changes will be listed here as they happen."
        icon={<History className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((evt, i) => {
          const meta = EVENT_META[evt.event] || EVENT_META.profile_updated;
          const Icon = meta.Icon;
          const isProfile = evt.event === 'profile_updated';
          const title = isProfile
            ? PROFILE_ACTION_LABELS[evt.status || ''] || meta.label
            : meta.label;
          // Profile events carry the audit action in status; it's already the title.
          const badge = isProfile ? null : evt.status;
          return (
            <li
              key={`${evt.event}-${evt.referenceId || i}-${evt.at}`}
              className="rounded-card border border-border bg-surface p-3 flex items-start gap-3"
            >
              <div
                className={`h-9 w-9 inline-flex items-center justify-center rounded-md shrink-0 ${meta.tone}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-ink truncate">
                    {title}
                    {evt.label && !isProfile && (
                      <span className="text-ink-muted font-normal">
                        {' '}
                        · {evt.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted shrink-0">
                    {formatDateTime(evt.at)}
                  </div>
                </div>
                <div className="text-xs text-ink-muted mt-0.5 flex items-center gap-3">
                  {evt.amount != null && (
                    <span className="text-ink">
                      {formatCurrency(evt.amount)}
                    </span>
                  )}
                  {evt.employeeUsername && (
                    <span>by {evt.employeeUsername}</span>
                  )}
                  {badge && (
                    <Badge size="sm" tone="muted">
                      {badge.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                {isProfile && <ChangeList evt={evt} />}
              </div>
            </li>
          );
        })}
      </ul>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CustomerProfilePage() {
  return (
    <RequirePermission permission="customer.view">
      <CustomerProfilePageContent />
    </RequirePermission>
  );
}
