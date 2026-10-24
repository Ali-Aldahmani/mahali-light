'use client';

import { usePathname } from 'next/navigation';
import { PageBodySkeleton } from '@/components/layout/AppSkeleton';

// Loading state between dashboard routes. It renders inside the dashboard
// layout, so the real sidebar and header stay put and only the page body
// is sketched.
export default function DashboardLoading() {
  const pathname = usePathname();
  return <PageBodySkeleton pathname={pathname} />;
}
