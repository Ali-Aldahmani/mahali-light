import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bug, ChevronDown, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useUiErrorStore } from '../../store/uiErrorStore.js';
import Avatar from '../ui/Avatar.jsx';
import { RoleBadge } from '../ui/Badge.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useSocketStore } from '../../store/socketStore.js';
import { logout as apiLogout } from '../../services/authService.js';
import PresenceWidget from './PresenceWidget.jsx';
import CashBalanceWidget from '../ui/CashBalanceWidget.jsx';
import NotificationBell from '../notifications/NotificationBell.jsx';
import NotificationPanel from '../notifications/NotificationPanel.jsx';

export default function Header({ title }) {
  const user = useAuthStore((s) => s.user);
  const isConnected = useSocketStore((s) => s.isConnected);
  const disconnect = useSocketStore((s) => s.disconnect);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const openBugReport = useUiErrorStore((s) => s.openBugReport);

  async function handleLogout() {
    try {
      await apiLogout();
    } finally {
      disconnect();
      navigate('/login', { replace: true });
    }
  }

  return (
    <header className="h-16 shrink-0 border-b border-border bg-surface px-6 flex items-center justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink truncate">{title || ''}</h2>
      </div>

      <div className="flex items-center gap-3">
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

        <NotificationBell />

        <PresenceWidget />

        <div className="h-8 w-px bg-border mx-1" />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-surface-2"
          >
            <Avatar name={user?.username} size="sm" online />
            <div className="text-left leading-tight">
              <p className="text-sm font-medium text-ink">{user?.username}</p>
              <p className="text-[11px] text-ink-muted">{user?.role}</p>
            </div>
            <ChevronDown size={14} className="text-ink-muted" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-2 w-64 card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-semibold text-ink">{user?.username}</p>
                  <div className="mt-1">
                    <RoleBadge role={user?.role} size="sm" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openBugReport();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"
                >
                  <Bug size={15} />
                  Report a bug
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-surface-2"
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <NotificationPanel />
    </header>
  );
}
