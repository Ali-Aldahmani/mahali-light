import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ShieldAlert } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ClaimResolutionBadge, {
  ClaimStatusBadge,
} from '../../components/ui/ClaimResolutionBadge.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useWarrantyStore } from '../../store/warrantyStore.js';
import { listClaims } from '../../services/warrantyClaimService.js';
import { formatDate } from '../../utils/format.js';
import { onWarrantyClaimEvent } from '../../store/socketStore.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'rejected', label: 'Rejected' },
];

const RESOLUTION_OPTIONS = [
  { value: '', label: 'Any resolution' },
  { value: 'replaced', label: 'Replaced' },
  { value: 'repaired', label: 'Repaired' },
  { value: 'rejected', label: 'Rejected' },
];

export default function WarrantyClaimsPage() {
  const navigate = useNavigate();
  const refreshSummary = useWarrantyStore((s) => s.refresh);
  const store = useWarrantyStore();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [resolution, setResolution] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);
  const seqRef = useRef(0);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  async function load() {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const res = await listClaims({
        page,
        limit: 25,
        status,
        resolution,
        from,
        to,
        search: debouncedSearch,
      });
      if (seq !== seqRef.current) return;
      setRows(res.data || []);
      setMeta(res.meta || null);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status, resolution, from, to, page]);

  useEffect(() => onWarrantyClaimEvent(() => {
    load();
    refreshSummary();
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedSearch, status, resolution, from, to, page]);

  const columns = [
    {
      key: 'claim',
      header: 'Claim',
      render: (row) => (
        <span className="font-mono text-xs">{row.claimNumber}</span>
      ),
    },
    {
      key: 'warranty',
      header: 'Warranty',
      render: (row) => (
        <span className="font-mono text-xs">{row.warrantyNumber}</span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      render: (row) => (
        <span className="text-sm truncate max-w-[220px] block">
          {row.productName || '—'}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div className="text-sm">
          {row.customerName || 'Guest'}
          {row.customerPhone && (
            <div className="text-xs text-ink-muted">{row.customerPhone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Claim date',
      render: (row) => formatDate(row.claimDate),
    },
    {
      key: 'issue',
      header: 'Issue',
      render: (row) => (
        <span className="text-sm line-clamp-2 max-w-[280px] block">
          {row.issueDescription}
        </span>
      ),
    },
    {
      key: 'resolution',
      header: 'Resolution',
      render: (row) =>
        row.resolution ? (
          <ClaimResolutionBadge resolution={row.resolution} size="sm" />
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <ClaimStatusBadge status={row.status} size="sm" />,
    },
  ];

  return (
    <div className="p-8">
      <PageHeader
        title="Warranty claims"
        subtitle="Track customer claims and supplier follow-up."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Open" value={store.openClaimsCount} tone="warning" />
        <SummaryCard label="In progress" value={store.inProgressClaimsCount} tone="accent" />
        <SummaryCard
          label="Resolved this month"
          value={store.resolvedThisMonthClaims}
          tone="success"
        />
        <SummaryCard label="Rejected" value={store.rejectedClaimsCount} tone="error" />
      </div>

      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <Input
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="Search claim, warranty, product or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="sm:col-span-2"
          />
          <Select
            value={status}
            onChange={(v) => setStatus(v)}
            options={STATUS_OPTIONS}
          />
          <Select
            value={resolution}
            onChange={(v) => setResolution(v)}
            options={RESOLUTION_OPTIONS}
          />
          <Input
            type="date"
            placeholder="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            type="date"
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <EmptyState
            icon={ShieldAlert}
            title="No claims found"
            description="Raise a claim from the warranty lookup screen or warranty detail page."
          />
        }
        onRowClick={(row) => navigate(`/warranty-claims/${row.id}`)}
        pagination={
          meta
            ? {
                page: meta.page,
                pageSize: meta.limit,
                total: meta.total,
                onPageChange: setPage,
              }
            : null
        }
      />
    </div>
  );
}

function SummaryCard({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'accent'
          ? 'text-accent'
          : tone === 'error'
            ? 'text-error'
            : 'text-ink';
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value || 0}</div>
    </div>
  );
}
