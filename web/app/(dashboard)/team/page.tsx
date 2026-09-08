'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Users, UsersRound, Shield } from 'lucide-react';
import Tabs from '@/components/ui/Tabs';
import { useAuthStore } from '@/store/authStore';
import UsersPage from '@/components/team/UsersPage';
import EmployeesPage from '@/components/team/EmployeesPage';
import RolesPage from '@/components/team/RolesPage';

const ALL_TABS = [
  {
    value: 'users',
    label: 'Users',
    icon: <Users className="h-4 w-4" />,
    permission: 'user.edit',
  },
  {
    value: 'employees',
    label: 'Employees',
    icon: <UsersRound className="h-4 w-4" />,
    permission: 'employee.view',
  },
  {
    value: 'roles',
    label: 'Roles',
    icon: <Shield className="h-4 w-4" />,
    permission: 'user.edit',
  },
];

export default function TeamPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const tabs = ALL_TABS.filter((t) => hasPermission(t.permission));

  // Resolve active tab: honour the URL param, fall back to the first allowed tab.
  const rawTab = searchParams.get('tab');
  const tab =
    tabs.find((t) => t.value === rawTab)?.value ?? tabs[0]?.value ?? 'users';

  function switchTab(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  if (!tabs.length) return null;

  return (
    <div className="space-y-0">
      <Tabs
        items={tabs}
        value={tab}
        onChange={switchTab}
        className="mb-6"
      />

      {tab === 'users' && <UsersPage />}
      {tab === 'employees' && <EmployeesPage />}
      {tab === 'roles' && <RolesPage />}
    </div>
  );
}
