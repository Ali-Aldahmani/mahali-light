import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import TransferForm from '../../../components/treasury/TransferForm.jsx';
import EmptyState from '../../../components/ui/EmptyState.jsx';
import {
  getDrawerState,
  listCashTransfers,
  transferCashToBank,
} from '../../../services/cashDrawerService.js';
import {
  listBankAccounts,
  bankTransfer,
} from '../../../services/bankAccountService.js';
import { useTreasuryStore } from '../../../store/treasuryStore.js';
import { onTreasuryEvent } from '../../../store/socketStore.js';
import { toast } from '../../../store/toastStore.js';
import { formatCurrency, formatDate } from '../../../utils/format.js';

export default function TransfersTab() {
  const refreshStore = useTreasuryStore((s) => s.refresh);
  const [drawer, setDrawer] = useState(null);
  const [banks, setBanks] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, b, t] = await Promise.all([
        getDrawerState(),
        listBankAccounts(),
        listCashTransfers({ limit: 50 }),
      ]);
      setDrawer({ id: d?.id, balance: Number(d?.currentBalance || 0) });
      setBanks(b);
      setTransfers(t?.data || []);
    } catch (_e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      onTreasuryEvent((p) => {
        if (
          p.kind === 'cash_balance' ||
          p.kind === 'bank_balance' ||
          p.kind === 'drawer_opened' ||
          p.kind === 'drawer_closed'
        ) {
          load();
        }
      }),
    [load],
  );

  async function handleTransfer({ from, to, amount, transferDate, notes, allowOverdraft }) {
    setSaving(true);
    try {
      if (from.type === 'cash_drawer' && to.type === 'bank_account') {
        await transferCashToBank({
          toId: to.id,
          amount,
          transferDate,
          notes,
        });
      } else if (from.type === 'bank_account') {
        await bankTransfer(from.id, {
          toType: to.type,
          toId: to.type === 'bank_account' ? to.id : null,
          amount,
          transferDate,
          notes,
          allowOverdraft,
        });
      } else {
        throw new Error('Unsupported transfer direction.');
      }
      toast.success('Transfer completed.');
      load();
      refreshStore();
    } catch (err) {
      toast.error(err?.message || 'Transfer failed.');
      throw err;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3">
          <div className="text-sm font-semibold text-ink">New transfer</div>
          <div className="text-xs text-ink-muted">
            Move money between the cash drawer and bank accounts.
          </div>
        </div>
        <TransferForm
          drawer={drawer}
          banks={banks}
          onSubmit={handleTransfer}
          loading={saving}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold text-ink">Transfer history</div>
        </div>
        {transfers.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight />}
            title="No transfers yet"
            description="Once you transfer money between accounts the records will appear here."
          />
        ) : (
          <Table
            columns={[
              {
                key: 'transferDate',
                header: 'Date',
                render: (r) => formatDate(r.transferDate),
              },
              { key: 'fromLabel', header: 'From' },
              { key: 'toLabel', header: 'To' },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (r) => formatCurrency(r.amount),
              },
              {
                key: 'employeeUsername',
                header: 'By',
                render: (r) => r.employeeUsername || '—',
              },
              { key: 'notes', header: 'Notes' },
            ]}
            rows={transfers}
            rowKey={(r) => r.id}
          />
        )}
      </div>
    </div>
  );
}
