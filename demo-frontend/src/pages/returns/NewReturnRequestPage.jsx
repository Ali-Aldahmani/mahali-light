import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ReturnLookupSearch from '../../components/returns/ReturnLookupSearch.jsx';
import RefundPreview from '../../components/returns/RefundPreview.jsx';
import PriceDiffCalculator from '../../components/returns/PriceDiffCalculator.jsx';
import ConditionBadge from '../../components/ui/ConditionBadge.jsx';
import ReturnTypeBadge from '../../components/ui/ReturnTypeBadge.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import { createReturnRequest } from '../../services/returnService.js';
import { searchProducts } from '../../services/productService.js';
import { formatCurrency, formatDate, timeAgo } from '../../utils/format.js';

const REASON_OPTIONS = [
  { value: 'defective', label: 'Defective' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'excess_stock', label: 'Excess stock' },
  { value: 'customer_request', label: 'Customer request' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
];

const STEPS = ['Lookup', 'Items', 'Plan', 'Review'];

export default function NewReturnRequestPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canApprove =
    (user?.permissions || []).includes('return.approve') ||
    (user?.permissions || []).includes('*');

  const [step, setStep] = useState(0);
  const [returnType, setReturnType] = useState('customer_refund');
  const [invoice, setInvoice] = useState(null);
  const [noInvoice, setNoInvoice] = useState(false);
  const [reason, setReason] = useState('defective');
  const [requestNote, setRequestNote] = useState('');
  const [selectedItems, setSelectedItems] = useState({});
  // map of invoiceItemId -> { qty, condition, serial }

  const [refundPlan, setRefundPlan] = useState([]);
  const [replacementItems, setReplacementItems] = useState([]);
  // Each entry: { id, sourceItemId, variantId, productName, sku, quantity, unitPrice }

  const [submitting, setSubmitting] = useState(false);

  // ---------------------------------------------------------------- Step 1
  function handleSelectInvoice(inv) {
    setInvoice(inv);
    setNoInvoice(false);
    // Pre-select items? Leave for the user to decide on step 2.
    setSelectedItems({});
    setStep(1);
  }

  function handleNoInvoice() {
    setInvoice(null);
    setNoInvoice(true);
    setSelectedItems({ manual: { qty: 1, condition: 'good', productName: '', unitPrice: 0 } });
    setStep(1);
  }

  // ---------------------------------------------------------------- Step 2
  function toggleItem(itemId) {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (next[itemId]) delete next[itemId];
      else {
        const src = invoice?.items?.find((it) => it.id === itemId);
        next[itemId] = {
          qty: src?.availableQty || src?.quantity || 1,
          condition: 'good',
          serial: src?.serialNumber || '',
        };
      }
      return next;
    });
  }

  function updateSelectedItem(itemId, patch) {
    setSelectedItems((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  const itemsForBackend = useMemo(() => {
    if (noInvoice) {
      // Manual entries — flatten to backend shape.
      return Object.entries(selectedItems).map(([key, v]) => ({
        invoiceItemId: null,
        productId: v.productId || null,
        variantId: v.variantId || null,
        productName: v.productName || `Manual item ${key}`,
        unitPrice: Number(v.unitPrice || 0),
        quantity: Number(v.qty || 1),
        condition: v.condition || 'good',
        serialNumber: v.serial || null,
      }));
    }
    if (!invoice) return [];
    return invoice.items
      .filter((it) => selectedItems[it.id])
      .map((it) => ({
        invoiceItemId: it.id,
        productId: it.productId,
        variantId: it.variantId,
        productName: it.productName,
        unitLabel: it.unitLabel,
        unitPrice: it.unitPrice,
        quantity: Number(selectedItems[it.id].qty),
        condition: selectedItems[it.id].condition,
        serialNumber: selectedItems[it.id].serial || null,
      }));
  }, [invoice, noInvoice, selectedItems]);

  const totalValue = useMemo(
    () =>
      itemsForBackend.reduce(
        (acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0),
        0,
      ),
    [itemsForBackend],
  );

  // ---------------------------------------------------------------- Step 3
  // Auto-suggest refund split when entering plan step.
  useEffect(() => {
    if (step !== 2 || returnType !== 'customer_refund') return;
    if (refundPlan.length > 0) return;
    // Default: cash refund of the full amount.
    setRefundPlan([{ method: 'cash', amount: round2(totalValue) }]);
  }, [step, returnType, totalValue, refundPlan.length]);

  const replacementTotal = useMemo(
    () =>
      replacementItems.reduce(
        (acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0),
        0,
      ),
    [replacementItems],
  );

  const priceDifference = round2(replacementTotal - totalValue);

  // ---------------------------------------------------------------- Validation
  function step1Valid() {
    return invoice != null || noInvoice;
  }
  function step2Valid() {
    if (itemsForBackend.length === 0) return false;
    if (requestNote.trim().length < 10) return false;
    if (noInvoice) {
      // Need product name, qty, unit price > 0 for each manual line.
      return itemsForBackend.every(
        (it) => it.productName && it.quantity > 0 && it.unitPrice > 0,
      );
    }
    return true;
  }
  function step3Valid() {
    if (returnType === 'customer_refund') {
      const sum = refundPlan.reduce((a, p) => a + Number(p.amount || 0), 0);
      return Math.abs(round2(sum) - round2(totalValue)) < 0.01 && refundPlan.length > 0;
    }
    if (returnType === 'customer_replace') {
      return replacementItems.length > 0;
    }
    return true; // supplier_return — no refund plan needed.
  }

  function next() {
    if (step === 0 && !step1Valid()) {
      toast.error('Select an invoice or choose "No invoice" to continue.');
      return;
    }
    if (step === 1) {
      if (itemsForBackend.length === 0) {
        toast.error('Select at least one item to return.');
        return;
      }
      if (requestNote.trim().length < 10) {
        toast.error('Please describe the reason in detail (at least 10 characters).');
        return;
      }
      if (noInvoice && !canApprove) {
        toast.error('No-invoice returns require a manager to file the request.');
        return;
      }
    }
    if (step === 2 && !step3Valid()) {
      if (returnType === 'customer_refund') {
        toast.error('Allocate the full refund amount across payment methods.');
      } else if (returnType === 'customer_replace') {
        toast.error('Pick at least one replacement product.');
      }
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleSubmit() {
    if (!step3Valid()) return;
    setSubmitting(true);
    try {
      let replacementPayload = null;
      if (returnType === 'customer_replace' && replacementItems.length > 0) {
        replacementPayload = {
          items: replacementItems.map((r) => ({
            variantId: r.variantId,
            productId: r.productId,
            productName: r.productName,
            quantity: Number(r.quantity),
            unitPrice: Number(r.unitPrice),
          })),
          priceDifference: Math.abs(priceDifference),
          differenceDirection:
            priceDifference > 0
              ? 'customer_pays'
              : priceDifference < 0
                ? 'refund_to_customer'
                : 'none',
        };
      }

      let refundPayload = null;
      if (returnType === 'customer_refund') {
        refundPayload = refundPlan
          .filter((p) => Number(p.amount) > 0)
          .map((p) => ({ method: p.method, amount: round2(p.amount), notes: p.notes || null }));
      } else if (
        returnType === 'customer_replace' &&
        priceDifference < 0
      ) {
        // Refund the excess to the customer — default to cash, manager can edit.
        refundPayload = [
          { method: 'cash', amount: Math.abs(priceDifference) },
        ];
      }

      const body = {
        returnType,
        referenceType: noInvoice ? 'manual' : 'invoice',
        referenceId: noInvoice ? null : invoice?.id || null,
        customerId: invoice?.customerId || null,
        noInvoiceReturn: !!noInvoice,
        approvedBy: noInvoice ? user?.id : null,
        reason,
        requestNote: requestNote.trim(),
        items: itemsForBackend,
        refundPlan: refundPayload,
        replacementPlan: replacementPayload,
      };

      const res = await createReturnRequest(body);
      toast.success(`Return request ${res.requestNumber} submitted.`);
      navigate(`/returns/requests/${res.id}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to submit return request.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader
        title="New return request"
        subtitle="Lookup the original transaction, capture the items, and review the refund or replacement plan."
      />

      <StepIndicator step={step} />

      <div className="mt-6 space-y-6">
        {step === 0 && (
          <LookupStep onSelect={handleSelectInvoice} onNoInvoice={handleNoInvoice} />
        )}
        {step === 1 && (
          <ItemsStep
            invoice={invoice}
            noInvoice={noInvoice}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            toggleItem={toggleItem}
            updateSelectedItem={updateSelectedItem}
            returnType={returnType}
            setReturnType={setReturnType}
            reason={reason}
            setReason={setReason}
            requestNote={requestNote}
            setRequestNote={setRequestNote}
            canApprove={canApprove}
          />
        )}
        {step === 2 && returnType === 'customer_refund' && (
          <RefundPlanStep
            total={totalValue}
            plan={refundPlan}
            setPlan={setRefundPlan}
          />
        )}
        {step === 2 && returnType === 'customer_replace' && (
          <ReplaceStep
            returnedItems={itemsForBackend}
            totalReturned={totalValue}
            replacementItems={replacementItems}
            setReplacementItems={setReplacementItems}
            priceDifference={priceDifference}
            replacementTotal={replacementTotal}
          />
        )}
        {step === 2 && returnType === 'supplier_return' && (
          <SupplierReturnPlanStep total={totalValue} />
        )}
        {step === 3 && (
          <ReviewStep
            invoice={invoice}
            noInvoice={noInvoice}
            items={itemsForBackend}
            returnType={returnType}
            reason={reason}
            requestNote={requestNote}
            refundPlan={refundPlan}
            replacementItems={replacementItems}
            totalValue={totalValue}
            priceDifference={priceDifference}
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={step === 0 ? () => navigate('/returns') : back}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            onClick={next}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            Next
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={submitting}
            rightIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            Submit request
          </Button>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${
                active
                  ? 'bg-accent text-white'
                  : done
                    ? 'bg-success-light text-success'
                    : 'bg-surface-2 text-ink-muted'
              }`}
            >
              {done ? '✓' : i + 1}
            </div>
            <span
              className={`font-medium ${
                active ? 'text-ink' : done ? 'text-success' : 'text-ink-muted'
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight className="h-3.5 w-3.5 text-ink-muted" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LookupStep({ onSelect, onNoInvoice }) {
  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          Find the original transaction
        </h2>
        <p className="text-sm text-ink-muted">
          Search by invoice number, customer, phone, serial number or product
          name. If the customer has no receipt, file a no-invoice return.
        </p>
      </div>
      <ReturnLookupSearch onSelect={onSelect} />
      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="text-sm text-ink-muted">
          No invoice on hand? Manager-only.
        </div>
        <Button variant="secondary" onClick={onNoInvoice}>
          File no-invoice return
        </Button>
      </div>
    </div>
  );
}

function ItemsStep({
  invoice,
  noInvoice,
  selectedItems,
  setSelectedItems,
  toggleItem,
  updateSelectedItem,
  returnType,
  setReturnType,
  reason,
  setReason,
  requestNote,
  setRequestNote,
  canApprove,
}) {
  return (
    <div className="space-y-6">
      {invoice && (
        <div className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-muted">
                Original invoice
              </div>
              <div className="font-mono text-lg font-semibold text-ink">
                {invoice.invoiceNumber}
              </div>
              <div className="text-xs text-ink-muted">
                {formatDate(invoice.createdAt)} · {timeAgo(invoice.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-ink-muted">
                Customer
              </div>
              <div className="font-medium text-ink">
                {invoice.customerName || 'Walk-in customer'}
              </div>
              {invoice.customerPhone && (
                <div className="text-xs text-ink-muted">
                  {invoice.customerPhone}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-ink-muted">
                Invoice total
              </div>
              <div className="text-lg font-semibold text-ink">
                {formatCurrency(invoice.total)}
              </div>
            </div>
          </div>
        </div>
      )}

      {noInvoice && !canApprove && (
        <div className="rounded-xl border border-warning/30 bg-warning-light p-4 text-sm text-warning">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Only managers can file no-invoice returns. Pass this to a manager.
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">Return type</h3>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: 'customer_refund', label: 'Refund' },
              { value: 'customer_replace', label: 'Replacement' },
              { value: 'supplier_return', label: 'Supplier return' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setReturnType(opt.value)}
                className={`h-9 rounded-input px-3 text-sm font-medium border transition ${
                  returnType === opt.value
                    ? 'border-accent bg-accent-light text-accent'
                    : 'border-border bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Reason"
            value={reason}
            onChange={(v) => setReason(v)}
            options={REASON_OPTIONS}
          />
        </div>

        <Textarea
          label="Request note"
          required
          hint="Required, minimum 10 characters. Be specific so the manager can review quickly."
          value={requestNote}
          onChange={(e) => setRequestNote(e.target.value)}
          rows={3}
          placeholder="Describe what happened and why this should be returned…"
        />
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Items to return</h3>
        {noInvoice ? (
          <ManualItemsEditor
            items={selectedItems}
            setItems={setSelectedItems}
          />
        ) : invoice ? (
          <InvoiceItemsTable
            items={invoice.items || []}
            selectedItems={selectedItems}
            toggleItem={toggleItem}
            updateSelectedItem={updateSelectedItem}
          />
        ) : (
          <div className="text-sm text-ink-muted">No invoice selected.</div>
        )}
      </div>
    </div>
  );
}

function InvoiceItemsTable({ items, selectedItems, toggleItem, updateSelectedItem }) {
  if (!items.length) {
    return <div className="text-sm text-ink-muted">This invoice has no items.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="py-2 pr-3"></th>
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3">Original qty</th>
            <th className="py-2 pr-3">Return qty</th>
            <th className="py-2 pr-3">Condition</th>
            <th className="py-2 pr-3">Unit price</th>
            <th className="py-2 pr-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const sel = selectedItems[it.id];
            const checked = !!sel;
            const maxQty = it.availableQty != null ? it.availableQty : it.quantity;
            const total =
              checked && sel.qty ? Number(sel.qty) * Number(it.unitPrice) : 0;
            return (
              <tr key={it.id} className="border-t border-border align-top">
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleItem(it.id)}
                    disabled={maxQty <= 0}
                  />
                </td>
                <td className="py-2 pr-3">
                  <div className="font-medium text-ink">{it.productName}</div>
                  {it.sku && (
                    <div className="text-xs text-ink-muted font-mono">{it.sku}</div>
                  )}
                  {it.serialNumber && (
                    <div className="text-xs text-ink-muted">
                      SN: <span className="font-mono">{it.serialNumber}</span>
                    </div>
                  )}
                  {maxQty <= 0 && (
                    <div className="mt-1 text-xs text-error">
                      Already covered by a return.
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-ink-muted">
                  {it.quantity} {it.unitLabel || ''}
                  {it.committedReturnQty > 0 && (
                    <div className="text-xs text-warning">
                      {it.committedReturnQty} on existing returns
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3" style={{ minWidth: 120 }}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    max={maxQty}
                    value={checked ? sel.qty : ''}
                    onChange={(e) =>
                      updateSelectedItem(it.id, { qty: e.target.value })
                    }
                    disabled={!checked}
                  />
                </td>
                <td className="py-2 pr-3" style={{ minWidth: 150 }}>
                  <Select
                    value={checked ? sel.condition : 'good'}
                    onChange={(v) =>
                      updateSelectedItem(it.id, { condition: v })
                    }
                    disabled={!checked}
                    options={[
                      { value: 'good', label: 'Good' },
                      { value: 'defective', label: 'Defective' },
                      { value: 'damaged', label: 'Damaged' },
                    ]}
                  />
                </td>
                <td className="py-2 pr-3 text-ink-muted">
                  {formatCurrency(it.unitPrice)}
                </td>
                <td className="py-2 pr-3 font-medium">
                  {checked ? formatCurrency(total) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ManualItemsEditor({ items, setItems }) {
  function addRow() {
    setItems((prev) => ({
      ...prev,
      [`manual-${Date.now()}`]: {
        qty: 1,
        condition: 'good',
        productName: '',
        unitPrice: 0,
      },
    }));
  }
  function removeRow(key) {
    setItems((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  function update(key, patch) {
    setItems((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  const rows = Object.entries(items);
  return (
    <div className="space-y-3">
      {rows.map(([key, row]) => (
        <div
          key={key}
          className="grid grid-cols-1 md:grid-cols-6 gap-2 rounded-lg bg-surface-2 p-3"
        >
          <Input
            containerClassName="md:col-span-2"
            placeholder="Product name"
            value={row.productName || ''}
            onChange={(e) => update(key, { productName: e.target.value })}
          />
          <Input
            type="number"
            placeholder="Qty"
            value={row.qty || ''}
            onChange={(e) => update(key, { qty: e.target.value })}
          />
          <Input
            type="number"
            placeholder="Unit price"
            value={row.unitPrice || ''}
            onChange={(e) => update(key, { unitPrice: e.target.value })}
          />
          <Select
            value={row.condition || 'good'}
            onChange={(v) => update(key, { condition: v })}
            options={[
              { value: 'good', label: 'Good' },
              { value: 'defective', label: 'Defective' },
              { value: 'damaged', label: 'Damaged' },
            ]}
          />
          <button
            type="button"
            onClick={() => removeRow(key)}
            className="inline-flex h-9 items-center justify-center rounded-input border border-border bg-surface text-ink-muted hover:text-error"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button variant="secondary" onClick={addRow}>
        Add another item
      </Button>
    </div>
  );
}

function RefundPlanStep({ total, plan, setPlan }) {
  function updateRow(idx, patch) {
    setPlan((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removeRow(idx) {
    setPlan((prev) => prev.filter((_, i) => i !== idx));
  }
  function addRow(method) {
    const allocated = plan.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const remaining = Math.max(0, round2(total - allocated));
    setPlan((prev) => [...prev, { method, amount: remaining }]);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-ink">
          Refund split — {formatCurrency(total)} total
        </h3>
        <p className="text-sm text-ink-muted">
          Allocate the full refund across one or more methods. We suggest
          matching the original payment.
        </p>
        {plan.map((p, idx) => (
          <div
            key={idx}
            className="grid grid-cols-12 items-center gap-2 rounded-lg bg-surface-2 p-3"
          >
            <Select
              containerClassName="col-span-3"
              value={p.method}
              onChange={(v) => updateRow(idx, { method: v })}
              options={[
                { value: 'cash', label: 'Cash' },
                { value: 'bank', label: 'Bank transfer' },
                { value: 'credit', label: 'Store credit' },
              ]}
            />
            <Input
              containerClassName="col-span-3"
              type="number"
              step="0.01"
              value={p.amount}
              onChange={(e) => updateRow(idx, { amount: e.target.value })}
            />
            <Input
              containerClassName="col-span-5"
              placeholder="Notes (optional)"
              value={p.notes || ''}
              onChange={(e) => updateRow(idx, { notes: e.target.value })}
            />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="col-span-1 inline-flex h-9 items-center justify-center rounded-input border border-border bg-surface text-ink-muted hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="secondary" onClick={() => addRow('cash')}>
            + Cash
          </Button>
          <Button variant="secondary" onClick={() => addRow('bank')}>
            + Bank
          </Button>
          <Button variant="secondary" onClick={() => addRow('credit')}>
            + Store credit
          </Button>
        </div>
      </div>
      <RefundPreview plan={plan} total={total} />
    </div>
  );
}

function ReplaceStep({
  returnedItems,
  totalReturned,
  replacementItems,
  setReplacementItems,
  priceDifference,
  replacementTotal,
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!searchQ || searchQ.trim().length < 2) {
      setSearchResults([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchProducts(searchQ, 20);
        if (!cancelled) setSearchResults(data || []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQ]);

  function addVariant(variant) {
    setReplacementItems((prev) => [
      ...prev,
      {
        id: `${variant.variantId || variant.id}-${Date.now()}`,
        variantId: variant.variantId || variant.id,
        productId: variant.productId,
        productName: variant.productName || variant.name,
        sku: variant.sku,
        quantity: 1,
        unitPrice: Number(variant.sellingPrice || variant.unitPrice || 0),
      },
    ]);
    setSearchQ('');
    setSearchResults([]);
  }

  function update(id, patch) {
    setReplacementItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }
  function remove(id) {
    setReplacementItems((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Returned items</h3>
          <ul className="space-y-1.5 text-sm">
            {returnedItems.map((it, idx) => (
              <li key={idx} className="flex justify-between">
                <span>
                  {it.productName}{' '}
                  <span className="text-ink-muted">× {it.quantity}</span>
                </span>
                <span className="font-medium">
                  {formatCurrency(Number(it.unitPrice) * Number(it.quantity))}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-2 text-sm font-semibold flex justify-between">
            <span>Returned value</span>
            <span>{formatCurrency(totalReturned)}</span>
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">
            Pick replacement products
          </h3>
          <Input
            placeholder="Search products by name or SKU…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          {searching && (
            <div className="text-xs text-ink-muted">Searching…</div>
          )}
          {searchResults.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-surface-2 p-2 max-h-60 overflow-y-auto">
              {searchResults.map((v) => (
                <button
                  key={v.variantId || v.id}
                  type="button"
                  onClick={() => addVariant(v)}
                  className="block w-full rounded-lg p-2 text-left text-sm hover:bg-surface"
                >
                  <div className="font-medium text-ink">
                    {v.productName || v.name}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {v.sku && `${v.sku} · `}
                    {formatCurrency(v.sellingPrice || 0)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {replacementItems.length > 0 && (
            <div className="space-y-2 mt-3">
              {replacementItems.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-12 items-center gap-2 rounded-lg bg-surface-2 p-3"
                >
                  <div className="col-span-5">
                    <div className="text-sm font-medium text-ink">
                      {row.productName}
                    </div>
                    {row.sku && (
                      <div className="text-xs text-ink-muted font-mono">
                        {row.sku}
                      </div>
                    )}
                  </div>
                  <Input
                    containerClassName="col-span-2"
                    type="number"
                    min="1"
                    value={row.quantity}
                    onChange={(e) => update(row.id, { quantity: e.target.value })}
                  />
                  <Input
                    containerClassName="col-span-3"
                    type="number"
                    step="0.01"
                    value={row.unitPrice}
                    onChange={(e) => update(row.id, { unitPrice: e.target.value })}
                  />
                  <div className="col-span-1 text-sm text-right font-medium">
                    {formatCurrency(Number(row.quantity) * Number(row.unitPrice))}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(row.id)}
                    className="col-span-1 inline-flex h-9 items-center justify-center rounded-input border border-border bg-surface text-ink-muted hover:text-error"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <PriceDiffCalculator
          originalValue={totalReturned}
          replacementValue={replacementTotal}
        />
        {priceDifference < 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning-light p-4 text-sm text-warning">
            The replacement is cheaper. {formatCurrency(Math.abs(priceDifference))}{' '}
            will be refunded to the customer in cash by default — the manager
            can override on review.
          </div>
        )}
        {priceDifference > 0 && (
          <div className="rounded-xl border border-accent/30 bg-accent-light p-4 text-sm text-accent">
            The customer pays an extra {formatCurrency(priceDifference)} — this
            will be charged when the manager approves the request.
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierReturnPlanStep({ total }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink mb-2">Supplier return</h3>
      <p className="text-sm text-ink-muted mb-3">
        Stock will be removed from inventory when the manager approves this
        request. The supplier's purchase order balance can be reconciled in the
        supplier profile once the credit note is issued.
      </p>
      <div className="rounded-lg bg-surface-2 p-3 text-sm flex justify-between">
        <span>Total value being returned</span>
        <span className="font-semibold">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

function ReviewStep({
  invoice,
  noInvoice,
  items,
  returnType,
  reason,
  requestNote,
  refundPlan,
  replacementItems,
  totalValue,
  priceDifference,
}) {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-muted">
              Return type
            </div>
            <ReturnTypeBadge type={returnType} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-muted">
              Total value
            </div>
            <div className="text-xl font-semibold text-ink">
              {formatCurrency(totalValue)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-muted">
              Reason
            </div>
            <div className="capitalize">{reason.replace(/_/g, ' ')}</div>
          </div>
          {invoice && (
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-muted">
                Original invoice
              </div>
              <div className="font-mono">{invoice.invoiceNumber}</div>
            </div>
          )}
          {noInvoice && (
            <div className="rounded-lg bg-warning-light px-3 py-1.5 text-sm font-medium text-warning">
              No-invoice return
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Items</h3>
        <ul className="space-y-2 text-sm">
          {items.map((it, idx) => (
            <li key={idx} className="flex items-center justify-between border-b border-border pb-2 last:border-b-0">
              <div>
                <div className="font-medium text-ink">{it.productName}</div>
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span>
                    {it.quantity} {it.unitLabel || ''} @ {formatCurrency(it.unitPrice)}
                  </span>
                  <ConditionBadge condition={it.condition} size="sm" />
                  {it.serialNumber && (
                    <span className="font-mono">SN: {it.serialNumber}</span>
                  )}
                </div>
              </div>
              <div className="font-medium">
                {formatCurrency(Number(it.quantity) * Number(it.unitPrice))}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-ink mb-2">Note for manager</h3>
        <p className="text-sm text-ink whitespace-pre-wrap">{requestNote}</p>
      </div>

      {returnType === 'customer_refund' && (
        <RefundPreview plan={refundPlan} total={totalValue} />
      )}
      {returnType === 'customer_replace' && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">Replacement plan</h3>
          <ul className="space-y-1.5 text-sm">
            {replacementItems.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>
                  {r.productName}{' '}
                  <span className="text-ink-muted">× {r.quantity}</span>
                </span>
                <span className="font-medium">
                  {formatCurrency(Number(r.quantity) * Number(r.unitPrice))}
                </span>
              </li>
            ))}
          </ul>
          <PriceDiffCalculator
            originalValue={totalValue}
            replacementValue={replacementItems.reduce(
              (acc, r) => acc + Number(r.quantity) * Number(r.unitPrice),
              0,
            )}
          />
          {priceDifference < 0 && (
            <div className="text-sm text-warning">
              {formatCurrency(Math.abs(priceDifference))} will be refunded in
              cash by default.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
