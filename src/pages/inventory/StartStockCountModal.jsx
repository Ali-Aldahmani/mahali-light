import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import { useProductStore } from '../../store/productStore.js';
import { createCount } from '../../services/stockCountService.js';
import { toast } from '../../store/toastStore.js';

const TYPE_OPTIONS = [
  { value: 'full', label: 'Full count (all products)' },
  { value: 'category', label: 'By category' },
  // partial / custom variant lists come later when there's a picker for it.
];

export default function StartStockCountModal({ open, onClose, onCreated }) {
  const categoriesFlat = useProductStore((s) => s.categoriesFlat);
  const fetchCategories = useProductStore((s) => s.fetchCategories);

  const [countType, setCountType] = useState('full');
  const [categoryId, setCategoryId] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setCountType('full');
      setCategoryId(null);
      setNotes('');
      setError(null);
      fetchCategories?.();
    }
  }, [open, fetchCategories]);

  if (!open) return null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        countType,
        notes: notes.trim() || undefined,
      };
      if (countType === 'category') {
        if (!categoryId) {
          setError('Please pick a category.');
          setSubmitting(false);
          return;
        }
        payload.categoryId = categoryId;
      }
      const result = await createCount(payload);
      toast.success('Stock count started.');
      onCreated?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not start the count.');
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = (categoriesFlat || []).map((c) => ({
    value: c.id,
    label: c.path?.map((p) => p.name).join(' / ') || c.name,
  }));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-ink">Start stock count</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:bg-surface-2 h-8 w-8 rounded-md flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <Select
            label="Count type"
            value={countType}
            onChange={setCountType}
            options={TYPE_OPTIONS}
            searchable={false}
          />

          {countType === 'category' && (
            <Select
              label="Category"
              value={categoryId}
              onChange={setCategoryId}
              options={categoryOptions}
              placeholder="Pick a category…"
            />
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
              rows={2}
              placeholder="What's the reason for this count?"
            />
          </div>

          <div className="flex items-start gap-2 rounded-input bg-warning-light text-warning px-3 py-2 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              Adjustment requests will be blocked for products in this count
              until it is approved or rejected.
            </div>
          </div>

          {error && (
            <div className="rounded-input bg-error-light text-error px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} disabled={submitting}>
            Start count
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
