import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Unlock, Wallet, X } from 'lucide-react';
import { useTreasuryStore } from '../../store/treasuryStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatCurrency } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

// Compact widget that lives in the top header. Shows the live cash balance +
// drawer status. Clicking it pops a quick panel with shortcut actions
// (open/close drawer, jump to treasury).
export default function CashBalanceWidget() {
  const cashBalance = useTreasuryStore((s) => s.cashBalance);
  const drawerStatus = useTreasuryStore((s) => s.drawerStatus);
  const refreshDrawer = useTreasuryStore((s) => s.refreshDrawer);
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (user) refreshDrawer();
  }, [user, refreshDrawer]);

  if (!user || !hasPermission('cash.view')) return null;

  const isOpen = drawerStatus === 'open';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border',
          isOpen
            ? 'border-success/30 bg-success-light text-success hover:bg-success/15'
            : 'border-border bg-surface-2 text-ink-muted hover:bg-surface-2/80',
        )}
        title={
          isOpen
            ? `Cash drawer open — ${formatCurrency(cashBalance)}`
            : 'Cash drawer closed'
        }
      >
        {isOpen ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        {isOpen ? <Wallet className="h-3.5 w-3.5" /> : null}
        <span>
          {isOpen ? formatCurrency(cashBalance) : 'Drawer closed'}
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-40 mt-2 w-72 card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <p className="text-xs text-ink-muted">Cash drawer</p>
                <p className="text-base font-semibold text-ink">
                  {isOpen ? formatCurrency(cashBalance) : 'Closed'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <Link
                to="/treasury?tab=cash"
                className="block px-2 py-1.5 rounded hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                Go to cash drawer
              </Link>
              {hasPermission('cash.adjust') && (
                <Link
                  to={isOpen ? '/treasury?tab=cash&action=close' : '/treasury?tab=cash&action=open'}
                  className="block px-2 py-1.5 rounded hover:bg-surface-2 text-accent"
                  onClick={() => setOpen(false)}
                >
                  {isOpen ? 'Close drawer' : 'Open drawer'}
                </Link>
              )}
              <Link
                to="/treasury"
                className="block px-2 py-1.5 rounded hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                Treasury overview
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
