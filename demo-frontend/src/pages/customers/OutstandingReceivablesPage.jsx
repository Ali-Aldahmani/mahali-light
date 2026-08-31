import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Wallet,
  AlertCircle,
  Users,
  CreditCard,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import CustomerAvatar from '../../components/ui/CustomerAvatar.jsx';
import CreditBalanceBadge from '../../components/ui/CreditBalanceBadge.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import { getOutstandingReceivables } from '../../services/customerService.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { onCustomerBalanceUpdate } from '../../store/socketStore.js';
import CollectPaymentSlideOver from './CollectPaymentSlideOver.jsx';

const SORT_OPTIONS = [
  { value: 'balance', label: 'Highest balance' },
  { value: 'days', label: 'Days since last payment' },
  { value: 'name', label: 'Customer name' },
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function OutstandingReceivablesPage() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canCollect = permissions.includes('customer.collect_payment');

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('balance');
  const [paying, setPaying] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getOutstandingReceivables();
      setRows(res?.data || []);
      setTotal(res?.meta?.totals?.totalOutstanding || 0);
    } catch (err) {
      toast.error(err?.message || 'Failed to load receivables.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    return onCustomerBalanceUpdate(() => load());
  }, []);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    if (sort === 'balance') {
      arr.sort(
        (a, b) => Number(b.creditBalance || 0) - Number(a.creditBalance || 0),
      );
    } else if (sort === 'days') {
      arr.sort(
        (a, b) =>
          (b.daysSinceLastPayment ?? Number.POSITIVE_INFINITY) -
          (a.daysSinceLastPayment ?? Number.POSITIVE_INFINITY),
      );
    } else if (sort === 'name') {
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return arr;
  }, [rows, sort]);

  function exportCsv() {
    const headers = [
      'Customer',
      'Company',
      'Phone',
      'Credit balance (AED)',
      'Credit limit (AED)',
      'Last payment',
      'Days since last payment',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of sortedRows) {
      lines.push(
        [
          r.name,
          r.companyName || '',
          r.phone || '',
          Number(r.creditBalance || 0).toFixed(2),
          Number(r.creditLimit || 0).toFixed(2),
          r.lastPaymentDate ? formatDate(r.lastPaymentDate) : '',
          r.daysSinceLastPayment ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receivables-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      render: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <CustomerAvatar customer={r} size="sm" />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/customers/${r.id}`)}
              className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[240px]"
            >
              {r.name}
            </button>
            <div className="text-xs text-ink-muted truncate">
              {r.companyName || r.phone || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (r) => r.phone || '—',
    },
    {
      key: 'creditBalance',
      header: 'Balance',
      align: 'right',
      render: (r) => (
        <CreditBalanceBadge balance={r.creditBalance} limit={r.creditLimit} />
      ),
    },
    {
      key: 'lastPaymentDate',
      header: 'Last payment',
      render: (r) =>
        r.lastPaymentDate ? formatDate(r.lastPaymentDate) : (
          <span className="text-ink-muted">Never</span>
        ),
    },
    {
      key: 'daysSinceLastPayment',
      header: 'Days since',
      align: 'right',
      render: (r) =>
        r.daysSinceLastPayment != null ? `${r.daysSinceLastPayment} d` : '—',
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      sortable: false,
      render: (r) =>
        canCollect && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<CreditCard className="h-4 w-4" />}
            onClick={(e) => {
              e.stopPropagation();
              setPaying(r);
            }}
          >
            Collect
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => navigate('/customers')}
      >
        Customers
      </Button>

      <PageHeader
        title="Outstanding receivables"
        subtitle="Customers who currently owe the store money."
        action={
          <Button
            variant="secondary"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="Total outstanding"
          value={formatCurrency(total)}
          tone={total > 0 ? 'warning' : 'default'}
        />
        <SummaryCard
          icon={<Users className="h-5 w-5" />}
          label="Customers with balance"
          value={rows.length}
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Aged 30+ days"
          value={
            rows.filter((r) => (r.daysSinceLastPayment ?? 0) > 30).length
          }
          tone={
            rows.filter((r) => (r.daysSinceLastPayment ?? 0) > 30).length > 0
              ? 'error'
              : 'default'
          }
        />
      </div>

      <div className="flex items-end justify-end">
        <div className="w-56">
          <Select
            label="Sort by"
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            searchable={false}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={sortedRows}
        rowKey={(r) => r.id}
        loading={loading}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        empty={
          <EmptyState
            title="No outstanding balances"
            description="All customer accounts are settled. Nice work."
            icon={<Wallet className="h-6 w-6" />}
          />
        }
      />

      <CollectPaymentSlideOver
        open={!!paying}
        onClose={() => setPaying(null)}
        customer={paying}
        onCollected={() => {
          setPaying(null);
          load();
        }}
      />
    </div>
  );
}

function SummaryCard({ icon, label, value, tone = 'default' }) {
  const TONES = {
    default: 'bg-surface text-ink',
    warning: 'bg-warning-light text-warning',
    error: 'bg-error-light text-error',
    success: 'bg-success-light text-success',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card flex items-start justify-between">
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-xl font-semibold text-ink mt-1">{value}</div>
      </div>
      <div className={`h-9 w-9 rounded-md flex items-center justify-center ${TONES[tone]}`}>
        {icon}
      </div>
    </div>
  );
}
