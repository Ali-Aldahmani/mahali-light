// Single source of truth for what the phone experience can reach.
//
// Two different refusals, never to be conflated:
//   - device restriction  → the feature exists but only on desktop
//   - permission restriction → the user's role doesn't grant it
// Permissions here only choose what to render; Express enforces them.

export const MOBILE_HOME = '/m/dashboard';

export interface MobileRoute {
  path: string;
  /** Any-of: the user needs at least one. Empty = any signed-in user. */
  permissions: string[];
  /** Desktop page with the same purpose, for non-phone visitors. */
  desktopPath: string;
}

export const MOBILE_ROUTES: MobileRoute[] = [
  { path: '/m/dashboard', permissions: [], desktopPath: '/dashboard' },
  { path: '/m/invoices', permissions: ['invoice.view'], desktopPath: '/invoices' },
  { path: '/m/expenses', permissions: ['bills.view'], desktopPath: '/expenses' },
  { path: '/m/top-products', permissions: ['analytics.view'], desktopPath: '/analytics?tab=products' },
  { path: '/m/account', permissions: [], desktopPath: '/dashboard' },
  { path: '/m/products/new', permissions: ['product.create'], desktopPath: '/products/new' },
  { path: '/m/products/new/manual', permissions: ['product.create'], desktopPath: '/products/new' },
  { path: '/m/products/new/details', permissions: ['product.create'], desktopPath: '/products/new' },
];

// Desktop paths that have a phone counterpart. Anything not listed is
// desktop-only — including every detail/edit page (/invoices/[id],
// /products/[id]/edit, ...), which is why matching is exact.
const DESKTOP_TO_MOBILE: Record<string, string> = {
  '/': MOBILE_HOME,
  '/dashboard': MOBILE_HOME,
  '/invoices': '/m/invoices',
  '/expenses': '/m/expenses',
  '/products/new': '/m/products/new',
};

export const ADD_PRODUCT_PERMISSION = 'product.create';

export function hasAnyPermission(owned: readonly string[] | null | undefined, required: readonly string[]) {
  if (!required.length) return true;
  const set = new Set(owned || []);
  if (set.has('*')) return true;
  return required.some((p) => set.has(p));
}

function normalize(pathname: string) {
  const p = (pathname || '/').split('?')[0].split('#')[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

export function findMobileRoute(pathname: string): MobileRoute | null {
  const p = normalize(pathname);
  return MOBILE_ROUTES.find((r) => r.path === p) || null;
}

export type MobileAccess =
  | { kind: 'allowed'; route: MobileRoute }
  | { kind: 'permission-denied'; route: MobileRoute }
  | { kind: 'not-found' };

export function mobileAccess(pathname: string, permissions: readonly string[]): MobileAccess {
  const route = findMobileRoute(pathname);
  if (!route) return { kind: 'not-found' };
  return hasAnyPermission(permissions, route.permissions)
    ? { kind: 'allowed', route }
    : { kind: 'permission-denied', route };
}

export type PhoneDecision =
  | { kind: 'redirect'; to: string }
  | { kind: 'desktop-required' };

/** What a phone should do when it lands on a desktop (non-/m) route. */
export function phoneDecisionForDesktopPath(pathname: string): PhoneDecision {
  const target = DESKTOP_TO_MOBILE[normalize(pathname)];
  return target ? { kind: 'redirect', to: target } : { kind: 'desktop-required' };
}

/** Where a non-phone visitor of a /m route belongs. */
export function desktopPathForMobile(pathname: string): string {
  return findMobileRoute(pathname)?.desktopPath || '/dashboard';
}

export function isMobilePath(pathname: string) {
  const p = normalize(pathname);
  return p === '/m' || p.startsWith('/m/');
}
