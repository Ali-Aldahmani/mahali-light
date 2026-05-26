import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import CustomerAvatar from '../../components/ui/CustomerAvatar.jsx';
import OutstandingBalanceCard from '../../components/ui/OutstandingBalanceCard.jsx';
import PaymentMethodIcon from '../../components/ui/PaymentMethodIcon.jsx';
import PaymentStatusBadge from '../../components/ui/PaymentStatusBadge.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import {
  getCustomer,
  getCustomerPayments,
  getCustomerInvoices,
  getCustomerReturns,
  getCustomerWarranties,
  getCustomerTimeline,
} from '../../services/customerService.js';
import { voidPayment } from '../../services/customerPaymentService.js';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../utils/format.js';
import CustomerFormSlideOver from './CustomerFormSlideOver.jsx';
import CollectPaymentSlideOver from './CollectPaymentSlideOver.jsx';
import { onCustomerBalanceUpdate } from '../../store/socketStore.js';

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

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'invoices';

  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('customer.edit');
  const canCollect = permissions.includes('customer.collect_payment');
  const canSeeBalance = permissions.includes('customer.view_balance');

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  async function loadCustomer() {
    setLoading(true);
    try {
      setCustomer(await getCustomer(id));
    } catch (err) {
      toast.error(err?.message || 'Customer not found.');
      navigate('/customers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return onCustomerBalanceUpdate((evt) => {
      if (evt?.customerId === id) loadCustomer();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !customer) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  function setTab(value) {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => navigate('/customers')}
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
        />
        <StatCard
          icon={<Wallet className="h-4 w-4" />}
          label="Credit balance"
          value={
            canSeeBalance ? formatCurrency(customer.creditBalance || 0) : '—'
          }
          tone={customer.creditBalance > 0 ? 'warning' : 'default'}
        />
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Last purchase"
          value={
            customer.lastPurchaseDate
              ? formatDate(customer.lastPurchaseDate)
              : '—'
          }
        />
        <StatCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Last payment"
          value={
            customer.lastPaymentDate
              ? formatDate(customer.lastPaymentDate)
              : '—'
          }
        />
        <StatCard
          icon={<Receipt className="h-4 w-4" />}
          label="Invoices"
          value={customer.invoiceCount || 0}
        />
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Avg order value"
          value={formatCurrency(customer.avgOrderValue || 0)}
        />
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'invoices' && <InvoicesTab customerId={id} />}
      {tab === 'payments' && (
        <PaymentsTab
          customerId={id}
          canCollect={canCollect}
          customer={customer}
          onChanged={loadCustomer}
          openPay={() => setPayOpen(true)}
        />
      )}
      {tab === 'returns' && <ReturnsTab customerId={id} />}
      {tab === 'warranties' && <WarrantiesTab customerId={id} />}
      {tab === 'timeline' && <TimelineTab customerId={id} />}

      <CustomerFormSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        customer={customer}
        onSaved={loadCustomer}
      />

      <CollectPaymentSlideOver
        open={payOpen}
        onClose={() => setPayOpen(false)}
        customer={customer}
        onCollected={loadCustomer}
      />
    </div>
  );
}

function ContactCard({ customer }) {
  const lines = [
    customer.phone && { icon: <Phone className="h-4 w-4" />, value: customer.phone },
    customer.email && { icon: <Mail className="h-4 w-4" />, value: customer.email },
    customer.address && { icon: <MapPin className="h-4 w-4" />, value: customer.address },
    customer.companyName && {
      icon: <Building2 className="h-4 w-4" />,
      value: customer.companyName,
    },
  ].filter(Boolean);

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

function CreditCardInfo({ customer }) {
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

function StatCard({ icon, label, value, tone = 'default' }) {
  const TONES = {
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
    </div>
  );
}

// Tabs --------------------------------------------------------------------

function InvoicesTab({ customerId }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerInvoices(customerId)
      .then((data) => {
        if (!cancelled) setRows(data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const columns = [
    {
      key: 'invoice',
      header: 'Invoice',
      render: (r) => (
        <button
          type="button"
          onClick={() => navigate(`/invoices/${r.id}`)}
          className="font-mono text-sm text-ink hover:text-accent"
        >
          {r.invoiceNumber}
        </button>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (r) => (
        <span className="text-xs text-ink-muted">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      align: 'right',
      render: (r) => r.itemCount,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (r) => formatCurrency(r.total),
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      render: (r) => formatCurrency(r.amountPaid),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (r) =>
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
      header: 'Status',
      render: (r) => (
        <PaymentStatusBadge status={r.paymentStatus} size="sm" />
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`/invoices/${r.id}`)}
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

function PaymentsTab({ customerId, canCollect, customer, onChanged, openPay }) {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [voidingId, setVoidingId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getCustomerPayments(customerId);
      setData({
        rows: res?.data || [],
        total: res?.meta?.totals?.totalCollected || 0,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function handleVoid(p) {
    if (!confirm('Reverse this payment? Same-day payments only.')) return;
    setVoidingId(p.id);
    try {
      await voidPayment(p.id);
      toast.success('Payment voided.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err?.message || 'Could not void payment.');
    } finally {
      setVoidingId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-muted">
          Total collected:{' '}
          <span className="font-medium text-ink">
            {formatCurrency(data.total)}
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
            render: (r) => formatDate(r.paymentDate || r.createdAt),
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (r) => (
              <span className="font-medium text-ink">
                {formatCurrency(r.amount)}
              </span>
            ),
          },
          {
            key: 'method',
            header: 'Method',
            render: (r) => <PaymentMethodIcon method={r.paymentMethod} />,
          },
          {
            key: 'employee',
            header: 'Collected by',
            render: (r) => r.employeeUsername || '—',
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (r) => (
              <span className="text-xs text-ink-muted">{r.notes || '—'}</span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            sortable: false,
            render: (r) => {
              const isToday =
                new Date(r.createdAt).toISOString().slice(0, 10) === today;
              if (!canCollect || !isToday) return null;
              return (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleVoid(r)}
                  loading={voidingId === r.id}
                >
                  Void
                </Button>
              );
            },
          },
        ]}
        rows={data.rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title="No payments yet"
            description="Once you collect a payment from this customer, it will appear here."
            icon={<Banknote className="h-6 w-6" />}
          />
        }
      />
    </div>
  );
}

function ReturnsTab({ customerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerReturns(customerId)
      .then((r) => setRows(r || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  return (
    <EmptyState
      title="Returns available in Phase 9"
      description="Customer returns and refunds will appear here once returns is enabled."
      icon={<RefreshCw className="h-6 w-6" />}
    />
  );
}

function WarrantiesTab({ customerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCustomerWarranties(customerId)
      .then((r) => setRows(r || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  return (
    <EmptyState
      title="Warranties available in Phase 8"
      description="Warranty cards and claim history will appear here once warranties is enabled."
      icon={<ShieldCheck className="h-6 w-6" />}
    />
  );
}

const EVENT_META = {
  invoice_created: {
    label: 'Invoice created',
    Icon: Receipt,
    tone: 'text-accent bg-accent-light',
  },
  payment_collected: {
    label: 'Payment collected',
    Icon: Banknote,
    tone: 'text-success bg-success-light',
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

function TimelineTab({ customerId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerTimeline(customerId)
      .then((data) => {
        if (!cancelled) setItems(data || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Invoices, payments, and profile changes will be listed here as they happen."
        icon={<History className="h-6 w-6" />}
      />
    );
  }

  const visible = items.slice(0, limit);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {visible.map((evt, i) => {
          const meta = EVENT_META[evt.event] || EVENT_META.profile_updated;
          const Icon = meta.Icon;
          return (
            <li
              key={`${evt.referenceId || i}-${evt.at}`}
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
                    {meta.label}
                    {evt.label && (
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
                  {evt.status && (
                    <Badge size="sm" tone="muted">
                      {evt.status}
                    </Badge>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > limit && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            onClick={() => setLimit((n) => n + 50)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
