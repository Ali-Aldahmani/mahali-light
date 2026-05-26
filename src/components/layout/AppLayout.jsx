import { useEffect, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { useSocketStore } from '../../store/socketStore.js';
import { useAuthStore } from '../../store/authStore.js';

const TITLES = {
  '/dashboard': 'Dashboard',
  '/users': 'Users',
  '/employees': 'Employees',
  '/roles': 'Roles & Permissions',
  '/products': 'Products',
  '/products/new': 'New product',
  '/categories': 'Categories',
  '/attributes': 'Attributes',
};

export default function AppLayout() {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    if (!token) return undefined;
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const title = useMemo(() => {
    // Pick the longest matching prefix so /products/new wins over /products.
    const match = Object.keys(TITLES)
      .filter((k) => location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return match ? TITLES[match] : '';
  }, [location.pathname]);

  return (
    <div className="h-screen flex bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
