import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CreditCard, Landmark } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import ReturnTypeBadge from '../../components/ui/ReturnTypeBadge.jsx';
import ReturnStatusBadge from '../../components/ui/ReturnStatusBadge.jsx';
import ConditionBadge from '../../components/ui/ConditionBadge.jsx';
import StockActionBadge from '../../components/ui/StockActionBadge.jsx';
import { getReturnOrder } from '../../services/returnOrderService.js';
import { toast } from '../../store/toastStore.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';

const METHOD_ICON = {
  cash: Banknote,
  bank: Landmark,
  credit: CreditCard,
};

export default function ReturnOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getReturnOrder(id);
        if (!cancelled) setOrder(data);
      } catch (err) {
        if (!cancelled) toast.error(err?.message || 'Failed to load return order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-ink-muted">Loading return order…</div>;
  }
  if (!order) {
    return <div className="p-8 text-sm text-error">Return order not found.</div>;
  }

  return (
    <div className="p-8">
      <PageHeader
        title={order.returnOrderNumber}
        subtitle="Executed return order details."
        action={
          <Button
            variant="ghost"
            onClick={() => navigate('/returns')}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back to returns
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ReturnTypeBadge type={order.returnType} />
                <ReturnStatusBadge status={order.status} />
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-ink-muted">
                  Total returned
                </div>
                <div className="text-xl font-semibold text-ink">
                  {formatCurrency(order.totalValue || 0)}
                </div>
                <div className="text-xs text-ink-muted">
                  Refunded {formatCurrency(order.refundTotal || 0)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm pt-2 border-t border-border">
              {order.customerName && (
                <Field
                  label="Customer"
                  value={
                    <Link to={`/customers/${order.customerId}`} className="text-accent hover:underline">
                      {order.customerName}
                    </Link>
                  }
                />
              )}
              {order.supplierName && (
                <Field
                  label="Supplier"
                  value={
                    <Link to={`/suppliers/${order.supplierId}`} className="text-accent hover:underline">
                      {order.supplierName}
                    </Link>
                  }
                />
              )}
              {order.originalInvoiceId && (
                <Field
                  label="Original invoice"
                  value={
                    <Link to={`/invoices/${order.originalInvoiceId}`} className="font-mono text-accent hover:underline">
                      {order.originalInvoiceNumber}
                    </Link>
                  }
                />
              )}
              {order.replacementInvoiceId && (
                <Field
                  label="Replacement invoice"
                  value={
                    <Link to={`/invoices/${order.replacementInvoiceId}`} className="font-mono text-accent hover:underline">
                      {order.replacementInvoiceNumber}
                    </Link>
                  }
                />
              )}
              {order.requestNumber && (
                <Field
                  label="From request"
                  value={
                    <Link to={`/returns/requests/${order.returnRequestId}`} className="font-mono text-accent hover:underline">
                      {order.requestNumber}
                    </Link>
                  }
                />
              )}
              <Field
                label="Processed"
                value={formatDateTime(order.createdAt)}
                hint={order.employeeUsername || '—'}
              />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Items returned</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Unit</th>
                    <th className="py-2 pr-3">Condition</th>
                    <th className="py-2 pr-3">Stock action</th>
                    <th className="py-2 pr-3">Serial</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items || []).map((it) => (
                    <tr key={it.id} className="border-t border-border">
                      <td className="py-2 pr-3">{it.productName}</td>
                      <td className="py-2 pr-3">
                        {it.quantity} {it.unitLabel || ''}
                      </td>
                      <td className="py-2 pr-3">{formatCurrency(it.unitPrice)}</td>
                      <td className="py-2 pr-3">
                        <ConditionBadge condition={it.condition} size="sm" />
                      </td>
                      <td className="py-2 pr-3">
                        <StockActionBadge action={it.stockAction} size="sm" />
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {it.serialNumber || '—'}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {formatCurrency(it.totalValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {order.notes && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink mb-2">Notes</h3>
              <p className="text-sm text-ink whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink mb-3">Refund payments</h3>
          {(order.refundPayments || []).length === 0 ? (
            <div className="text-sm text-ink-muted">No refund payments recorded.</div>
          ) : (
            <ul className="space-y-2">
              {order.refundPayments.map((p) => {
                const Icon = METHOD_ICON[p.method] || Banknote;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-accent" />
                      <span className="capitalize font-medium">{p.method}</span>
                      {p.notes && (
                        <span className="text-xs text-ink-muted">— {p.notes}</span>
                      )}
                    </div>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 border-t border-border pt-2 flex justify-between text-sm font-semibold">
            <span>Total refunded</span>
            <span>{formatCurrency(order.refundTotal || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, hint }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="text-sm text-ink">{value || '—'}</div>
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
