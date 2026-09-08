'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import Spinner from '@/components/ui/Spinner';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import {
  getSupplier,
  getSupplierPurchaseOrders,
  getSupplierPayments,
  getSupplierProducts,
  getSupplierReturns,
  getSupplierTimeline,
} from '@/services/supplierService';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/format';
import POStatusBadge from '@/components/ui/POStatusBadge';
import AttachmentCard from '@/components/ui/AttachmentCard';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import PaymentHistoryTable from '@/components/ui/PaymentHistoryTable';
import CostTrendIndicator from '@/components/ui/CostTrendIndicator';
import Table, { type TableColumn } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { fileUrl } from '@/lib/config';
import SupplierFormSlideOver from '@/components/suppliers/SupplierFormSlideOver';
import { onPurchaseOrderEvent } from '@/store/socketStore';
import type { Supplier } from '@/components/suppliers/types';
import type { Payment, PurchaseOrder } from '@/components/purchases/types';

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

function SupplierProfilePageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'orders';

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const permissions = useAuthStore((s: any) => s.permissions);
  const canEdit = permissions.includes('supplier.edit');
  const canCreatePo = permissions.includes('supplier.purchase_order.create');
  const canSeeCost = permissions.includes('product.view_cost');

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  async function loadSupplier() {
    setLoading(true);
    try {
      setSupplier(await getSupplier(id));
    } catch (err: any) {
      toast.error(err?.message || 'Supplier not found.');
      router.push('/suppliers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSupplier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return onPurchaseOrderEvent((evt: any) => {
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
        onClick={() => router.push('/suppliers')}
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
                  router.push(`/purchase-orders/new?supplierId=${supplier.id}`)
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
            tone={(supplier.outstandingBalance || 0) > 0 ? 'warning' : 'default'}
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
          tone={(supplier.defectRate || 0) > 5 ? 'error' : 'default'}
        />
      </div>

      <Tabs items={TABS} value={tab} onChange={setTab} />

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

function ContactCard({ supplier }: { supplier: Supplier }) {
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

function ContactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
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

function StatCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'error' | 'success';
}) {
  const TONES: Record<string, string> = {
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

function PurchaseOrdersTab({
  supplier,
  canCreatePo,
}: {
  supplier: Supplier;
  canCreatePo: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPurchaseOrders(supplier.id)
      .then((data: PurchaseOrder[]) => setRows(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const columns: TableColumn[] = [
    {
      key: 'poNumber',
      header: 'PO #',
      render: (r: PurchaseOrder) => (
        <button
          type="button"
          onClick={() => router.push(`/purchase-orders/${r.id}`)}
          className="text-sm font-medium text-ink hover:text-accent"
        >
          {r.poNumber}
        </button>
      ),
    },
    {
      key: 'orderDate',
      header: 'Date',
      render: (r: PurchaseOrder) => formatDate(r.orderDate),
    },
    { key: 'itemsCount', header: 'Items', align: 'right' },
    {
      key: 'totalCost',
      header: 'Total',
      align: 'right' as const,
      render: (r: PurchaseOrder) => formatCurrency(r.totalCost),
    },
    {
      key: 'amountPaid',
      header: 'Paid',
      align: 'right' as const,
      render: (r: PurchaseOrder) => formatCurrency(r.amountPaid),
    },
    {
      key: 'balanceDue',
      header: 'Balance',
      align: 'right' as const,
      render: (r: PurchaseOrder) => (
        <span className={(r.balanceDue || 0) > 0 ? 'text-accent font-medium' : ''}>
          {formatCurrency(r.balanceDue)}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      render: (r: PurchaseOrder) => {
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
      render: (r: PurchaseOrder) => (
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
              router.push(`/purchase-orders/new?supplierId=${supplier.id}`)
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
        rowKey={(r: PurchaseOrder) => r.id}
        onRowClick={(r: PurchaseOrder) => router.push(`/purchase-orders/${r.id}`)}
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

function PaymentsTab({ supplier }: { supplier: Supplier }) {
  const [rows, setRows] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPayments(supplier.id)
      .then((data: Payment[]) => setRows(data || []))
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

interface SupplierProductRow {
  variantId: number;
  productId: number;
  productName: string;
  productImage?: string | null;
  sku?: string;
  latestCost?: number | null;
  previousCost?: number | null;
  totalUnitsBought?: number;
  purchaseCount?: number;
  lastOrderDate?: string | null;
}

function ProductsTab({ supplier }: { supplier: Supplier }) {
  const router = useRouter();
  const [rows, setRows] = useState<SupplierProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const permissions = useAuthStore((s: any) => s.permissions);
  const canSeeCost = permissions.includes('product.view_cost');

  useEffect(() => {
    setLoading(true);
    getSupplierProducts(supplier.id)
      .then((data: SupplierProductRow[]) => setRows(data || []))
      .finally(() => setLoading(false));
  }, [supplier.id]);

  const columns: TableColumn[] = [
    {
      key: 'product',
      header: 'Product',
      render: (r: SupplierProductRow) => (
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
              onClick={() => router.push(`/products/${r.productId}`)}
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
            align: 'right' as const,
            render: (r: SupplierProductRow) => (
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
      align: 'right' as const,
    },
    {
      key: 'purchaseCount',
      header: 'Orders',
      align: 'right' as const,
    },
    {
      key: 'lastOrderDate',
      header: 'Last order',
      render: (r: SupplierProductRow) => formatDate(r.lastOrderDate),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(r: SupplierProductRow) => r.variantId}
      empty={
        <EmptyState
          title="No products purchased yet"
          description="Products will appear here after the first PO is received."
        />
      }
    />
  );
}

interface LegacyReturnRow {
  id: number;
  returnNumber: string;
  returnDate: string;
  itemsCount: number;
  totalValue: number;
  reason: string;
  resolution?: string | null;
  status: string;
}

interface ReturnRequestRow {
  id: number;
  requestNumber: string;
  requestedAt: string;
  poId?: number;
  poNumber?: string;
  itemCount: number;
  totalValue: number;
  status: string;
}

function ReturnsTab({ supplier }: { supplier: Supplier }) {
  const [data, setData] = useState<{ legacy: LegacyReturnRow[]; requests: ReturnRequestRow[] }>({
    legacy: [],
    requests: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierReturns(supplier.id)
      .then((res: any) => {
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

  const legacyColumns: TableColumn[] = [
    { key: 'returnNumber', header: 'Return #' },
    {
      key: 'returnDate',
      header: 'Date',
      render: (r: LegacyReturnRow) => formatDate(r.returnDate),
    },
    { key: 'itemsCount', header: 'Items', align: 'right' },
    {
      key: 'totalValue',
      header: 'Value',
      align: 'right' as const,
      render: (r: LegacyReturnRow) => formatCurrency(r.totalValue),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r: LegacyReturnRow) => (
        <Badge tone="muted" size="sm">
          {r.reason}
        </Badge>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      render: (r: LegacyReturnRow) =>
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
      render: (r: LegacyReturnRow) => (
        <Badge tone={r.status === 'resolved' ? 'success' : 'warning'} size="sm" dot>
          {r.status}
        </Badge>
      ),
    },
  ];

  const requestColumns: TableColumn[] = [
    {
      key: 'requestNumber',
      header: 'Request #',
      render: (r: ReturnRequestRow) => (
        <Link
          href={`/returns/requests/${r.id}`}
          className="font-mono text-xs text-accent hover:underline"
        >
          {r.requestNumber}
        </Link>
      ),
    },
    {
      key: 'requestedAt',
      header: 'Date',
      render: (r: ReturnRequestRow) => formatDate(r.requestedAt),
    },
    {
      key: 'poNumber',
      header: 'PO',
      render: (r: ReturnRequestRow) =>
        r.poNumber ? (
          <Link
            href={`/purchase-orders/${r.poId}`}
            className="font-mono text-xs text-accent hover:underline"
          >
            {r.poNumber}
          </Link>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: 'itemCount', header: 'Items', align: 'right' },
    {
      key: 'totalValue',
      header: 'Value',
      align: 'right' as const,
      render: (r: ReturnRequestRow) => formatCurrency(r.totalValue),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: ReturnRequestRow) => (
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
            rowKey={(r: ReturnRequestRow) => r.id}
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
            rowKey={(r: LegacyReturnRow) => r.id}
          />
        </div>
      )}
    </div>
  );
}

const EVENT_META: Record<string, { label: string; tone: string; icon: string }> = {
  po_created: { label: 'PO created', tone: 'accent', icon: '📦' },
  po_received: { label: 'PO received', tone: 'success', icon: '📬' },
  payment_added: { label: 'Payment made', tone: 'success', icon: '💰' },
  return_created: { label: 'Return sent', tone: 'warning', icon: '🔄' },
};

interface TimelineItem {
  event: string;
  referenceId?: string | number;
  label?: string;
  employeeUsername?: string;
  at: string;
  amount?: number | null;
}

function TimelineTab({ supplier }: { supplier: Supplier }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierTimeline(supplier.id)
      .then((data: TimelineItem[]) => setItems(data || []))
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

function AttachmentsTab({ supplier }: { supplier: Supplier }) {
  const router = useRouter();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getSupplierPurchaseOrders(supplier.id)
      .then((data: PurchaseOrder[]) => setPos((data || []).filter((p) => p.attachmentPath)))
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
          onClick={() => router.push(`/purchase-orders/${po.id}`)}
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

export default function SupplierProfilePage() {
  return (
    <RequirePermission permission="supplier.view">
      <SupplierProfilePageContent />
    </RequirePermission>
  );
}
