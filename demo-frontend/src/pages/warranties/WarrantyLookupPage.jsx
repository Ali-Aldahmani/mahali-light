import { useEffect, useRef, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Input from '../../components/ui/Input.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import WarrantyStatusCard from '../../components/ui/WarrantyStatusCard.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { lookupWarranties } from '../../services/warrantyService.js';
import RaiseClaimSlideOver from './RaiseClaimSlideOver.jsx';

// Counter-staff focused page: a big search bar + colour-coded result cards.
// Designed so a cashier can type a serial number or invoice in seconds and
// know whether the warranty is still valid.
export default function WarrantyLookupPage() {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 200);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const seqRef = useRef(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!debounced || debounced.trim().length < 2) {
      setResults([]);
      setTouched(false);
      return;
    }
    let cancelled = false;
    const seq = ++seqRef.current;
    setLoading(true);
    setTouched(true);
    lookupWarranties(debounced.trim())
      .then((data) => {
        if (cancelled || seq !== seqRef.current) return;
        setResults(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const [claimFor, setClaimFor] = useState(null);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader
        title="Warranty lookup"
        subtitle="Search by serial number, invoice, customer name, phone or warranty number."
      />

      <div className="card p-5 mb-6">
        <div className="flex items-center gap-3">
          <Search className="h-5 w-5 text-ink-muted shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by serial number, invoice number, customer name or phone..."
            containerClassName="flex-1"
            className="text-base h-12"
            autoFocus
          />
        </div>
      </div>

      {loading && (
        <div className="text-center text-ink-muted py-12">Searching…</div>
      )}

      {!loading && touched && results.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No warranty found"
          description="No active or historical warranties match this search."
        />
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          {results.map((w) => (
            <WarrantyStatusCard
              key={w.id}
              warranty={w}
              onRaiseClaim={(warranty) => setClaimFor(warranty)}
            />
          ))}
        </div>
      )}

      {!touched && !loading && (
        <div className="card p-8 text-center text-ink-muted">
          <ShieldCheck className="h-10 w-10 mx-auto text-accent mb-3" />
          <p className="text-sm">
            Start typing to look up a warranty. We&apos;ll search serial
            numbers, invoices, customer names &amp; phones, and warranty
            numbers all at once.
          </p>
        </div>
      )}

      <RaiseClaimSlideOver
        warranty={claimFor}
        open={!!claimFor}
        onClose={(refresh) => {
          setClaimFor(null);
          if (refresh && debounced) {
            const seq = ++seqRef.current;
            lookupWarranties(debounced).then((d) => {
              if (seq === seqRef.current) setResults(Array.isArray(d) ? d : []);
            });
          }
        }}
      />
    </div>
  );
}
