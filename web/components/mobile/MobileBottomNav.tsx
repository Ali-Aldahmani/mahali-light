'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/store/authStore';
import { ADD_PRODUCT_PERMISSION, findMobileRoute, hasAnyPermission } from '@/lib/mobile/routePolicy';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  activeIcon: string;
  /** Other paths that light this tab up. */
  also?: string[];
}

const LEFT: NavItem[] = [
  {
    href: '/m/dashboard',
    label: 'Dashboard',
    icon: '/mobile/nav-dashboard.svg',
    activeIcon: '/mobile/nav-dashboard-active.svg',
    also: ['/m/top-products'],
  },
  {
    href: '/m/invoices',
    label: 'Invoices',
    icon: '/mobile/nav-invoices.svg',
    activeIcon: '/mobile/nav-invoices-active.svg',
  },
];

const RIGHT: NavItem[] = [
  {
    href: '/m/expenses',
    label: 'Expenses',
    icon: '/mobile/nav-expenses.svg',
    activeIcon: '/mobile/nav-expenses-active.svg',
  },
  {
    href: '/m/account',
    label: 'Account',
    icon: '/mobile/nav-account.svg',
    activeIcon: '/mobile/nav-account-active.svg',
  },
];

// Centre cut-out of the Figma navbar background (x 93.75→281.25 of 375).
function NotchBackground() {
  return (
    <svg
      aria-hidden
      className="block h-full w-[187.5px] shrink-0"
      viewBox="0 0 187.5 80.115"
      preserveAspectRatio="none"
      fill="none"
    >
      <path
        d="M0 0H37.07C43.087 0 48.595 3.37538 51.326 8.73632L58.11 22.0496C72.947 51.1707 114.553 51.1707 129.39 22.0496L136.174 8.73632C138.905 3.37538 144.413 0 150.43 0H187.5V80.115H0V0Z"
        fill="white"
      />
    </svg>
  );
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className="flex h-20 min-w-0 flex-1 flex-col items-center justify-center gap-2 transition-opacity active:opacity-60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={active ? item.activeIcon : item.icon} alt="" aria-hidden className="h-6 w-6" />
      <span
        className={cn(
          'font-m-work text-[12px] leading-none tracking-[0.12px] whitespace-nowrap',
          active ? 'font-semibold text-m-accent' : 'font-normal text-ink-muted',
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname() || '';
  const permissions = useAuthStore((s) => s.permissions);

  const visible = (item: NavItem) => {
    const route = findMobileRoute(item.href);
    return !route || hasAnyPermission(permissions, route.permissions);
  };
  const isActive = (item: NavItem) =>
    pathname === item.href || (item.also || []).includes(pathname);

  const left = LEFT.filter(visible);
  const right = RIGHT.filter(visible);
  const canAdd = hasAnyPermission(permissions, [ADD_PRODUCT_PERMISSION]);
  const addActive = pathname.startsWith('/m/products/new');

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
    >
      <div className="pointer-events-auto relative h-20 w-full max-w-[375px] drop-shadow-[0_-5px_26px_rgba(0,0,0,0.03)]">
        <div aria-hidden className="absolute inset-0 flex">
          {canAdd ? (
            <>
              <div className="flex-1 rounded-tl-[24px] bg-white" />
              <NotchBackground />
              <div className="flex-1 rounded-tr-[24px] bg-white" />
            </>
          ) : (
            <div className="flex-1 rounded-t-[24px] bg-white" />
          )}
        </div>

        <div className="relative flex h-full">
          <div className="flex flex-1">
            {left.map((item) => (
              <Tab key={item.href} item={item} active={isActive(item)} />
            ))}
          </div>
          {canAdd && (
            <div className="relative w-[75px] shrink-0">
              <Link
                href="/m/products/new"
                aria-label="Add product"
                aria-current={addActive ? 'page' : undefined}
                className="absolute left-1/2 top-[2px] flex h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-m-accent transition-transform active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/mobile/nav-scan.svg" alt="" aria-hidden className="h-[22px] w-[22px]" />
              </Link>
            </div>
          )}
          <div className="flex flex-1">
            {right.map((item) => (
              <Tab key={item.href} item={item} active={isActive(item)} />
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
