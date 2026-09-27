'use client';

import { forwardRef, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import {
  Expand,
  FileSearch,
  Grid3x3,
  Loader2,
  LogOut,
  PackageSearch,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  ScanLine,
  Shrink,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

// ---- Top bar ----------------------------------------------------------------

export interface CashierTopBarProps {
  storeName: string;
  userName: string;
  query: string;
  resolving: boolean;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  canCustomer: boolean;
  onQueryChange: (value: string) => void;
  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCustomer: () => void;
  onQuickActions: () => void;
  onToggleFullscreen: () => void;
}

export const CashierTopBar = forwardRef<HTMLInputElement, CashierTopBarProps>(function CashierTopBar(
  props,
  searchRef,
) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
      <div className="hidden min-w-0 shrink-0 flex-col pr-2 lg:flex">
        <span className="truncate text-sm font-bold text-ink">{props.storeName}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-accent">Cashier Mode</span>
      </div>

      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search products or scan barcode</span>
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          value={props.query}
          onChange={(e) => props.onQueryChange(e.target.value)}
          onKeyDown={props.onSearchKeyDown}
          placeholder="Scan barcode or search products…"
          className="h-12 w-full rounded-input border border-border bg-surface pl-11 pr-20 text-base text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {props.resolving && <Loader2 className="h-4 w-4 animate-spin text-accent" aria-label="Looking up" />}
          <kbd className="hidden rounded border border-border px-1.5 text-[10px] text-ink-muted sm:inline">F2</kbd>
        </span>
      </label>

      {props.canCustomer && (
        <BarButton Icon={UserPlus} label="Customer" hint="F6" onClick={props.onCustomer} />
      )}
      <BarButton Icon={Grid3x3} label="Quick actions" hint="F9" onClick={props.onQuickActions} />
      {props.fullscreenSupported && (
        <BarButton
          Icon={props.isFullscreen ? Shrink : Expand}
          label={props.isFullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={props.onToggleFullscreen}
          iconOnly
        />
      )}
      <span className="hidden max-w-[10rem] truncate pl-1 text-sm text-ink-muted xl:inline" title={props.userName}>
        {props.userName}
      </span>
    </header>
  );
});

// ---- Bottom bar -------------------------------------------------------------

export interface CashierBottomBarProps {
  online: boolean;
  pcIdentifier: string;
  canHold: boolean;
  canViewInvoices: boolean;
  canStock: boolean;
  canReturn: boolean;
  holding: boolean;
  onHold: () => void;
  onResume: () => void;
  onInvoices: () => void;
  onStock: () => void;
  onReturn: () => void;
  onExit: () => void;
}

export function CashierBottomBar(props: CashierBottomBarProps) {
  return (
    <footer className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-surface px-3 py-2">
      {props.canHold && (
        <BarButton Icon={PauseCircle} label="Hold" hint="F7" onClick={props.onHold} busy={props.holding} />
      )}
      {props.canViewInvoices && (
        <>
          <BarButton Icon={PlayCircle} label="Held sales" hint="F8" onClick={props.onResume} />
          <BarButton Icon={FileSearch} label="Invoices" onClick={props.onInvoices} />
        </>
      )}
      {props.canStock && <BarButton Icon={PackageSearch} label="Stock" onClick={props.onStock} />}
      {props.canReturn && <BarButton Icon={RotateCcw} label="Return" onClick={props.onReturn} />}
      <span className="flex-1" />
      <span
        role="status"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium',
          props.online ? 'bg-success-light text-success' : 'bg-error-light text-error',
        )}
      >
        {props.online ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
        {props.online ? 'Online' : 'Offline — sales can’t be completed'}
        <span className="text-ink-muted">· {props.pcIdentifier}</span>
      </span>
      <BarButton Icon={LogOut} label="Exit" onClick={props.onExit} />
    </footer>
  );
}

function BarButton({
  Icon,
  label,
  hint,
  onClick,
  iconOnly = false,
  busy = false,
}: {
  Icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
  iconOnly?: boolean;
  busy?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={iconOnly ? label : undefined}
      title={hint ? `${label} (${hint})` : label}
      className={cn(
        'inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-input border border-border bg-surface text-sm font-medium text-ink',
        'touch-manipulation hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60',
        iconOnly ? 'w-12' : 'px-3',
      )}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
      {!iconOnly && <span className="sr-only sm:not-sr-only">{label}</span>}
      {hint && !iconOnly && (
        <kbd className="hidden rounded border border-border px-1 text-[10px] text-ink-muted lg:inline">{hint}</kbd>
      )}
    </button>
  );
}
