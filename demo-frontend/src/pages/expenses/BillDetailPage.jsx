import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Pencil,
  Pause,
  Play,
  XCircle,
  CreditCard,
  ExternalLink,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import BillStatusBadge from '../../components/ui/BillStatusBadge.jsx';
import BillPaymentStatusBadge from '../../components/ui/BillPaymentStatusBadge.jsx';
import DaysUntilDueBadge from '../../components/ui/DaysUntilDueBadge.jsx';
import ExpenseCategoryIcon from '../../components/ui/ExpenseCategoryIcon.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import BillFormSlideOver from '../../components/bills/BillFormSlideOver.jsx';
import PayBillSlideOver from '../../components/bills/PayBillSlideOver.jsx';
import {
  getBill,
  cancelBill,
  pauseBill,
  resumeBill,
} from '../../services/billService.js';
import { useAuthStore } from '../../store/authStore.js';
import { onBillEvent } from '../../store/socketStore.js';
import { toast } from '../../store/toastStore.js';
import { fileUrl } from '../../config.js';

function aed(n) {
  return `AED ${Number(n || 0).toFixed(2)}`;
}

export default function BillDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await getBill(id);
      setBill(data);
    } catch (err) {
      toast.error(err?.message || 'Failed to load bill.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const unsub = onBillEvent((p) => {
      if (p.billId === id) reload();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onStatus(action) {
    try {
      if (action === 'cancel') await cancelBill(id);
      else if (action === 'pause') await pauseBill(id);
      else if (action === 'resume') await resumeBill(id);
      toast.success(`Bill ${action === 'cancel' ? 'cancelled' : action + 'd'}.`);
      reload();
    } catch (err) {
      toast.error(err?.message || 'Failed to update bill.');
    }
  }

  if (loading && !bill) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!bill) return null;

  const upcoming = (bill.payments || []).find(
    (p) => p.status !== 'paid',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <ExpenseCategoryIcon icon={bill.categoryIcon} name={bill.name} size="lg" />
          </span>
        }
        subtitle={`${bill.categoryName || ''}${
          bill.vendorName ? ' · ' + bill.vendorName : ''
        }`}
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<ChevronLeft size={14} />}
              onClick={() => navigate('/expenses')}
            >
              Back
            </Button>
            {hasPermission('bills.pay') && upcoming && bill.status === 'active' && (
              <Button
                leftIcon={<CreditCard size={14} />}
                onClick={() => setPaying(upcoming)}
              >
                Pay now
              </Button>
            )}
            {hasPermission('bills.manage') && bill.status !== 'cancelled' && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Pencil size={14} />}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                {bill.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Pause size={14} />}
                    onClick={() =>
                      setConfirm({
                        action: 'pause',
                        title: 'Pause this bill?',
                        description:
                          'No reminders or new cycles will be generated until it is resumed.',
                        variant: 'primary',
                      })
                    }
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Play size={14} />}
                    onClick={() => onStatus('resume')}
                  >
                    Resume
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  leftIcon={<XCircle size={14} />}
                  onClick={() =>
                    setConfirm({
                      action: 'cancel',
                      title: 'Cancel this bill?',
                      description:
                        'The bill will be marked cancelled and no further payments will be tracked.',
                      variant: 'danger',
                    })
                  }
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-card border border-border bg-surface p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Bill details</h3>
            <BillStatusBadge status={bill.status} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Field label="Vendor" value={bill.vendorName || '—'} />
            <Field label="Frequency" value={<span className="capitalize">{bill.frequency}</span>} />
            <Field
              label="Expected amount"
              value={bill.isVariableAmount ? 'Variable' : aed(bill.amount)}
            />
            <Field
              label="Reminder"
              value={`${bill.reminderDaysBefore} day(s) before`}
            />
            <Field
              label="Payment method"
              value={
                <div className="capitalize">
                  {bill.paymentMethod}
                  {bill.bankName && (
                    <span className="ml-1 text-xs text-ink-muted">
                      · {bill.bankName}
                    </span>
                  )}
                </div>
              }
            />
            <Field
              label="Auto-recurring"
              value={bill.autoRecurring ? 'Yes' : 'No'}
            />
            <Field label="Created" value={bill.createdByUsername || '—'} />
            <Field label="Start date" value={bill.startDate} />
          </dl>
          {bill.notes && (
            <div className="mt-4 rounded-input bg-surface-2 p-3 text-sm text-ink">
              {bill.notes}
            </div>
          )}
        </div>

        <div className="rounded-card border border-accent/30 bg-accent-light p-5 shadow-soft">
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Next due
          </div>
          <div className="mt-1 text-2xl font-semibold">{bill.nextDueDate}</div>
          <div className="mt-2 flex items-center gap-2">
            <DaysUntilDueBadge days={bill.daysUntilDue} />
            {upcoming?.status && (
              <BillPaymentStatusBadge status={upcoming.status} />
            )}
          </div>
          <div className="mt-3 text-sm">
            Amount due:{' '}
            <span className="font-semibold">
              {bill.isVariableAmount
                ? 'Variable'
                : aed(upcoming?.amountDue ?? bill.amount)}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface shadow-soft">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-medium">Payment history</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2 text-right">Amount due</th>
                <th className="px-4 py-2 text-right">Amount paid</th>
                <th className="px-4 py-2">Paid date</th>
                <th className="px-4 py-2">Paid by</th>
                <th className="px-4 py-2">Method</th>
                <th className="px-4 py-2">Receipt</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(bill.payments || []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-ink-muted">
                    No payments yet.
                  </td>
                </tr>
              )}
              {(bill.payments || []).map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">{p.dueDate}</td>
                  <td className="px-4 py-2 text-right">{aed(p.amountDue)}</td>
                  <td className="px-4 py-2 text-right">
                    {p.amountPaid != null ? aed(p.amountPaid) : '—'}
                  </td>
                  <td className="px-4 py-2">{p.paidDate || '—'}</td>
                  <td className="px-4 py-2">{p.paidByUsername || '—'}</td>
                  <td className="px-4 py-2 capitalize">
                    {p.paymentMethod || '—'}
                    {p.bankName && (
                      <span className="ml-1 text-xs text-ink-muted">
                        · {p.bankName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {p.receiptAttachment ? (
                      <a
                        href={fileUrl(p.receiptAttachment)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <ExternalLink size={14} /> View
                      </a>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <BillPaymentStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {p.status !== 'paid' &&
                      hasPermission('bills.pay') &&
                      bill.status === 'active' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPaying(p)}
                        >
                          Pay
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BillFormSlideOver
        open={editing}
        bill={bill}
        onClose={() => setEditing(false)}
        onSaved={reload}
      />
      <PayBillSlideOver
        open={!!paying}
        payment={paying}
        bill={bill}
        onClose={() => setPaying(null)}
        onPaid={reload}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.action === 'cancel' ? 'Cancel bill' : 'Pause bill'}
        variant={confirm?.variant}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          onStatus(c.action);
        }}
      />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
