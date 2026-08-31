import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Edit3,
  Plus,
  Phone,
  Mail,
  MapPin,
  Clock,
  Wallet,
  TrendingUp,
  Calendar,
  AlertCircle,
  Package,
  FileSpreadsheet,
  History,
  Banknote,
  Truck,
  ListChecks,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import {
  getSupplier,
  getSupplierPurchaseOrders,
  getSupplierPayments,
  getSupplierProducts,
  getSupplierReturns,
  getSupplierTimeline,
} from '../../services/supplierService.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import POStatusBadge from '../../components/ui/POStatusBadge.jsx';
import AttachmentCard from '../../components/ui/AttachmentCard.jsx';
import PaymentStatusBadge from '../../components/ui/PaymentStatusBadge.jsx';
import PaymentHistoryTable from '../../components/ui/PaymentHistoryTable.jsx';
import CostTrendIndicator from '../../components/ui/CostTrendIndicator.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { fileUrl } from '../../config.js';
import SupplierFormSlideOver from './SupplierFormSlideOver.jsx';
import { onPurchaseOrderEvent } from '../../store/socketStore.js';

const TABS = [
  { value: 'orders', label: 'Purchase orders', icon: <Truck className="h-4 w-4" /> },
  { value: 'payments', label: 'Payments', icon: <Banknote className="h-4 w-4" /> },
  { value: 'products', label: 'Products', icon: <Package className="h-4 w-4" /> },
  { value: 'returns', label: 'Returns', icon: <ListChecks className="h-4 w-4" /> },
  {
    value: 'attachments',
    label: 'Attachments',
    icon: <FileSpreadsheet className="h-4 w-4" />,
  },
  {
    value: 'timeline',
    label: 'Timeline',
    icon: <History className="h-4 w-4" />,
  },
];

export default function SupplierProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'orders';

  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('supplier.edit');
  const canCreatePo = permissions.includes('supplier.purchase_order.create');
  const canSeeCost = permissions.includes('product.view_cost');

  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  async function loadSupplier() {
    setLoading(true);
    try {
      setSupplier(await getSupplier(id));
    } catch (err) {
      toast.error(err?.message || 'Supplier not found.');
      navigate('/suppliers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSupplier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return onPurchaseOrderEvent((evt) => {
      if (evt?.supplierId === id || evt?.poNumber) {
        loadSupplier();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !supplier) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => navigate('/suppliers')}
      >
        All suppliers
      </Button>

      <PageHeader
        title={supplier.name}
        subtitle={
          supplier.contactPerson
            ? `Primary contact: ${supplier.contactPerson}`
            : 'Supplier profile'
        }
        action={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="secondary"
                leftIcon={<Edit3 className="h-4 w-4" />}
                onClick={() => setEditOpen(true)}
              >
                Edit
              </Button>
            )}
            {canCreatePo && (
              <Button
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() =>
                  navigate(`/purchase-orders/new?supplierId=${supplier.id}`)
                }
              >
                New purchase order
              </Button>
            )}
          </div>
        }
      />

      <ContactCard supplier={supplier} />

      <div className="grid grid-cols-6 gap-3">
        {canSeeCost && (
          <StatCard
            icon={<Wallet className="h-5 w-5" />}
            label="Total spent"
            value={formatCurrency(supplier.totalSpent || 0)}
          />
        )}
        {canSeeCost && (
          <StatCard
            icon={<AlertCircle className="h-5 w-5" />}
            label="Outstanding"
            value={formatCurrency(supplier.outstandingBalance || 0)}
            tone={supplier.outstandingBalance > 0 ? 'warning' : 'default'}
          />
        )}
        <StatCard
          icon={<Calendar className="h-5 w-5" />}
          label="Last payment"
          value={supplier.lastPaymentDate ? formatDate(supplier.lastPaymentDate) : '—'}
        />
        <StatCard
          icon={<Calendar className="h-5 w-5" />}
          label="Last order"
          value={supplier.lastOrderDate ? formatDate(supplier.lastOrderDate) : '—'}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Avg lead time"
          value={
            supplier.avgLeadTimeDays != null
              ? `${Number(supplier.avgLeadTimeDays).toFixed(1)} days`
              : '—'
          }
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Defect rate"
          value={
            supplier.defectRate != null
              ? `${Number(supplier.defectRate).toFixed(1)}%`
              : '—'
          }
          tone={supplier.defectRate > 5 ? 'error' : 'default'}
        />
      </div>

      <Tabs items={TABS} value={tab} onChange={(v) => setParams({ tab: v })} />

      <div>
        {tab === 'orders' && (
          <PurchaseOrdersTab supplier={supplier} canCreatePo={canCreatePo} />
        )}
        {tab === 'payments' && <PaymentsTab supplier={supplier} />}
        {tab === 'products' && <ProductsTab supplier={supplier} />}
        {tab === 'returns' && <ReturnsTab supplier={supplier} />}
        {tab === 'attachments' && <AttachmentsTab supplier={supplier} />}
        {tab === 'timeline' && <TimelineTab supplier={supplier} />}
      </div>

      <SupplierFormSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        supplier={supplier}
        onSaved={loadSupplier}
      />
    </div>
  );
}

function ContactCard({ supplier }) {
  return (
    <div className="card p-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ContactRow icon={<Phone className="h-4 w-4" />} label="Phone" value={supplier.phone} />
        <ContactRow icon={<Mail className="h-4 w-4" />} label="Email" value={supplier.email} />
        <ContactRow
          icon={<MapPin className="h-4 w-4" />}
          label="Address"
          value={supplier.address}
        />
        <ContactRow
          icon={<FileSpreadsheet className="h-4 w-4" />}
          label="Payment terms"
          value={
            supplier.paymentTerms
              ? `${supplier.paymentTerms} · lead time ${supplier.defaultLeadTimeDays || 0}d`
              : `Lead time ${supplier.defaultLeadTimeDays || 0} days`
          }
        />
      </div>
      {supplier.notes && (
        <div className="mt-4 rounded-input bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          {supplier.notes}
        </div>
      )}
    </div>
  );
}

function ContactRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 rounded-md bg-surface-2 flex items-center justify-center text-ink-muted shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-sm text-ink truncate" title={value || ''}>
          {value || '—'}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, tone = 'default' }) {
  const TONES = {
    default: 'bg-surface text-ink',
    warning: 'bg-warning-light text-warning',
    error: 'bg-error-light text-error',
    success: 'bg-success-light text-success',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[11px] text-ink-muted">{label}</div>
        <div className="text-sm font-semibold text-ink mt-1 truncate" title={String(value)}>
          {value}
        </div>
      </div>
      <div className={`h-8 w-8 rounded-md flex items-center justify-center ${TONES[tone]}`}>
        {icon}
      </div>
    </div>
  );
}

function PurchaseOrdersTab({ supplier, canCreatePo }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPurchaseOrders(supplier.id)
      .then((data) => setRows(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const columns = [
    {
      key: 'poNumber',
      header: 'PO #',
      render: (r) => (
        <button
          type="button"
          onClick={() => navigate(`/purchase-orders/${r.id}`)}
          className="text-sm font-medium text-ink hover:text-accent"
        >
          {r.poNumber}
        </button>
      ),
    },
    {
      key: 'orderDate',
      header: 'Date',
      render: (r) => formatDate(r.orderDate),
    },
    { key: 'itemsCount', header: 'Items', align: 'right' },
    {
      key: 'totalCost',
      header: 'Total',
      align: 'right',
      render: (r) => formatCurrency(r.totalCost),
    },
    {
      key: 'amountPaid',
      header: 'Paid',
      align: 'right',
      render: (r) => formatCurrency(r.amountPaid),
    },
    {
      key: 'balanceDue',
      header: 'Balance',
      align: 'right',
      render: (r) => (
        <span className={r.balanceDue > 0 ? 'text-accent font-medium' : ''}>
          {formatCurrency(r.balanceDue)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      render: (r) => {
        if (!r.dueDate) return '—';
        const overdue =
          new Date(r.dueDate) < new Date() && r.paymentStatus !== 'paid';
        return (
          <span className={overdue ? 'text-error' : ''}>
            {formatDate(r.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <POStatusBadge status={r.status} size="sm" />
          <PaymentStatusBadge status={r.paymentStatus} size="sm" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {canCreatePo && (
        <div className="flex justify-end">
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() =>
              navigate(`/purchase-orders/new?supplierId=${supplier.id}`)
            }
          >
            New PO
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
        empty={
          <EmptyState
            title="No purchase orders yet"
            description="Create the first PO for this supplier to start tracking orders."
          />
        }
      />
    </div>
  );
}

function PaymentsTab({ supplier }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPayments(supplier.id)
      .then((data) => setRows(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="space-y-3">
      <PaymentHistoryTable payments={rows} loading={loading} showPo />
      {rows.length > 0 && (
        <div className="flex justify-end text-sm text-ink-muted">
          Total paid: <span className="ml-2 font-medium text-ink">{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}

function ProductsTab({ supplier }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const permissions = useAuthStore((s) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  useEffect(() => {
    setLoading(true);
    getSupplierProducts(supplier.id)
      .then((data) => setRows(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
            {r.productImage ? (
              <img src={fileUrl(r.productImage)} alt="" className="h-full w-full object-cover" />
            ) : (
              '—'
            )}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/products/${r.productId}`)}
              className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[240px]"
              title={r.productName}
            >
              {r.productName}
            </button>
            <div className="text-xs text-ink-muted">
              SKU: {r.sku}
            </div>
          </div>
        </div>
      ),
    },
    ...(canSeeCost
      ? [
          {
            key: 'latestCost',
            header: 'Last cost',
            align: 'right',
            render: (r) => (
              <CostTrendIndicator
                current={r.latestCost}
                previous={r.previousCost}
              />
            ),
          },
        ]
      : []),
    {
      key: 'totalUnitsBought',
      header: 'Units bought',
      align: 'right',
    },
    {
      key: 'purchaseCount',
      header: 'Orders',
      align: 'right',
    },
    {
      key: 'lastOrderDate',
      header: 'Last order',
      render: (r) => formatDate(r.lastOrderDate),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r) => r.variantId}
      empty={
        <EmptyState
          title="No products purchased yet"
          description="Products will appear here after the first PO is received."
        />
      }
    />
  );
}

function ReturnsTab({ supplier }) {
  const [data, setData] = useState({ legacy: [], requests: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierReturns(supplier.id)
      .then((res) => {
        // Older API shape returned an array; new one is { legacy, requests }.
        if (Array.isArray(res)) {
          setData({ legacy: res, requests: [] });
        } else {
          setData({
            legacy: res?.legacy || [],
            requests: res?.requests || [],
          });
        }
      })
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const legacyColumns = [
    { key: 'returnNumber', header: 'Return #' },
    {
      key: 'returnDate',
      header: 'Date',
      render: (r) => formatDate(r.returnDate),
    },
    { key: 'itemsCount', header: 'Items', align: 'right' },
    {
      key: 'totalValue',
      header: 'Value',
      align: 'right',
      render: (r) => formatCurrency(r.totalValue),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <Badge tone="muted" size="sm">
          {r.reason}
        </Badge>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      render: (r) =>
        r.resolution ? (
          <Badge tone="accent" size="sm">
            {r.resolution}
          </Badge>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'resolved' ? 'success' : 'warning'} size="sm" dot>
          {r.status}
        </Badge>
      ),
    },
  ];

  const requestColumns = [
    {
      key: 'requestNumber',
      header: 'Request #',
      render: (r) => (
        <RouterLink
          to={`/returns/requests/${r.id}`}
          className="font-mono text-xs text-accent hover:underline"
        >
          {r.requestNumber}
        </RouterLink>
      ),
    },
    {
      key: 'requestedAt',
      header: 'Date',
      render: (r) => formatDate(r.requestedAt),
    },
    {
      key: 'poNumber',
      header: 'PO',
      render: (r) =>
        r.poNumber ? (
          <RouterLink
            to={`/purchase-orders/${r.poId}`}
            className="font-mono text-xs text-accent hover:underline"
          >
            {r.poNumber}
          </RouterLink>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: 'itemCount', header: 'Items', align: 'right' },
    {
      key: 'totalValue',
      header: 'Value',
      align: 'right',
      render: (r) => formatCurrency(r.totalValue),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge
          tone={
            r.status === 'approved'
              ? 'success'
              : r.status === 'rejected'
                ? 'error'
                : r.status === 'cancelled'
                  ? 'muted'
                  : 'warning'
          }
          size="sm"
          dot
        >
          {r.status}
        </Badge>
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

  if (!data.requests.length && !data.legacy.length) {
    return (
      <EmptyState
        title="No returns recorded"
        description="When you return goods to this supplier they will appear here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {data.requests.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Supplier return requests (Phase 9)
          </div>
          <Table
            columns={requestColumns}
            rows={data.requests}
            rowKey={(r) => r.id}
          />
        </div>
      )}
      {data.legacy.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Receive-stage returns
          </div>
          <Table
            columns={legacyColumns}
            rows={data.legacy}
            rowKey={(r) => r.id}
          />
        </div>
      )}
    </div>
  );
}

const EVENT_META = {
  po_created: { label: 'PO created', tone: 'accent', icon: '📦' },
  po_received: { label: 'PO received', tone: 'success', icon: '📬' },
  payment_added: { label: 'Payment made', tone: 'success', icon: '💰' },
  return_created: { label: 'Return sent', tone: 'warning', icon: '🔄' },
};

function TimelineTab({ supplier }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierTimeline(supplier.id)
      .then((data) => setItems(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!items.length) {
    return (
      <EmptyState
        title="No activity yet"
        description="As you record POs, payments, and returns, they'll show up here in chronological order."
      />
    );
  }

  return (
    <div className="card p-5">
      <ol className="relative border-l border-border ml-2">
        {items.map((it, idx) => {
          const meta = EVENT_META[it.event] || { label: it.event, icon: '•' };
          return (
            <li key={`${it.event}-${it.referenceId}-${idx}`} className="ml-6 mb-5">
              <div className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent-light text-base">
                <span aria-hidden>{meta.icon}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {meta.label}
                    {it.label ? <span className="text-ink-muted"> · {it.label}</span> : null}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {it.employeeUsername || 'system'} · {formatDateTime(it.at)}
                  </div>
                </div>
                {it.amount != null && (
                  <div className="text-sm font-medium text-ink shrink-0">
                    {formatCurrency(it.amount)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AttachmentsTab({ supplier }) {
  const navigate = useNavigate();
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPurchaseOrders(supplier.id)
      .then((data) => setPos((data || []).filter((p) => p.attachmentPath)))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!pos.length) {
    return (
      <EmptyState
        title="No attachments"
        description="Supplier invoices uploaded against purchase orders will appear here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {pos.map((po) => (
        <button
          key={po.id}
          type="button"
          onClick={() => navigate(`/purchase-orders/${po.id}`)}
          className="text-left"
        >
          <AttachmentCard
            path={po.attachmentPath}
            filename={`Invoice · ${po.poNumber}`}
            uploadedAt={po.orderDate}
          />
        </button>
      ))}
    </div>
  );
}
