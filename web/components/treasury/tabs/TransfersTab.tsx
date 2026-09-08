'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import Table from '@/components/ui/Table';
import TransferForm from '@/components/treasury/TransferForm';
import EmptyState from '@/components/ui/EmptyState';
import {
  getDrawerState,
  listCashTransfers,
  transferCashToBank,
} from '@/services/cashDrawerService';
import {
  listBankAccounts,
  bankTransfer,
} from '@/services/bankAccountService';
import { useTreasuryStore } from '@/store/treasuryStore';
import { onTreasuryEvent } from '@/store/socketStore';
import { toast } from '@/store/toastStore';
import { formatCurrency, formatDate } from '@/lib/utils/format';

interface DrawerSummary {
  id?: string;
  balance: number;
}

interface BankAccountLite {
  id: string;
  bankName: string;
  accountName: string;
  currentBalance?: number;
}

interface TransferRecord {
  id: string;
  transferDate: string;
  fromLabel: string;
  toLabel: string;
  amount: number;
  employeeUsername?: string;
  notes?: string;
}

interface TransferParty {
  type: 'cash_drawer' | 'bank_account';
  id: string;
}

interface TransferSubmission {
  from: TransferParty;
  to: TransferParty;
  amount: number;
  transferDate: string;
  notes?: string | null;
  allowOverdraft?: boolean;
}

export default function TransfersTab() {
  const refreshStore = useTreasuryStore((s) => s.refresh);
  const [drawer, setDrawer] = useState<DrawerSummary | null>(null);
  const [banks, setBanks] = useState<BankAccountLite[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
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
      onTreasuryEvent((p: { kind: string }) => {
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

  async function handleTransfer({
    from,
    to,
    amount,
    transferDate,
    notes,
    allowOverdraft,
  }: TransferSubmission) {
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
    } catch (err: any) {
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
                render: (r: TransferRecord) => formatDate(r.transferDate),
              },
              { key: 'fromLabel', header: 'From' },
              { key: 'toLabel', header: 'To' },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                render: (r: TransferRecord) => formatCurrency(r.amount),
              },
              {
                key: 'employeeUsername',
                header: 'By',
                render: (r: TransferRecord) => r.employeeUsername || '—',
              },
              { key: 'notes', header: 'Notes' },
            ]}
            rows={transfers}
            rowKey={(r: TransferRecord) => r.id}
          />
        )}
      </div>
    </div>
  );
}
