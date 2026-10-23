'use client';

import { usePathname } from 'next/navigation';
import { Wifi, WifiOff } from 'lucide-react';
import CashierModeEntry from '@/components/pos/CashierModeEntry';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import PresenceWidget from './PresenceWidget';
import CashBalanceWidget from '../ui/CashBalanceWidget';
import HeaderNotifications from '../notifications/HeaderNotifications';
import HeaderCommandPalette from '../search/HeaderCommandPalette';
import PCIdentifierBadge from './PCIdentifierBadge';
import HeaderUserMenu from './HeaderUserMenu';

export default function Header({ title }: { title?: string }) {
  const isConnected = useSocketStore((s) => s.isConnected);
  const pathname = usePathname();
  const canSell = useAuthStore((s) => s.hasPermission('invoice.create'));
  const onPos = pathname === '/pos' || pathname.startsWith('/pos/');

  return (
    <header className="h-16 shrink-0 border-b border-border bg-surface px-6 flex items-center justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink truncate">{title || ''}</h2>
      </div>

      <div className="flex items-center gap-3">
        <HeaderCommandPalette />
        {canSell && !onPos && <CashierModeEntry compact />}
        <PCIdentifierBadge />
        <div
          title={isConnected ? 'Live connection' : 'Disconnected'}
          className={
            isConnected
              ? 'inline-flex items-center gap-1 text-success text-xs'
              : 'inline-flex items-center gap-1 text-error text-xs'
          }
        >
          {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{isConnected ? 'Live' : 'Offline'}</span>
        </div>

        <CashBalanceWidget />

        <HeaderNotifications />

        <PresenceWidget />

        <div className="h-8 w-px bg-border mx-1" />

        <HeaderUserMenu />
      </div>
    </header>
  );
}
