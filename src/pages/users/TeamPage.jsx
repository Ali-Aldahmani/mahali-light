import { useSearchParams } from 'react-router-dom';
import { Users, UsersRound, Shield } from 'lucide-react';
import Tabs from '../../components/ui/Tabs.jsx';
import { useAuthStore } from '../../store/authStore.js';
import UsersPage from './UsersPage.jsx';
import EmployeesPage from './EmployeesPage.jsx';
import RolesPage from './RolesPage.jsx';

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
  const [params, setParams] = useSearchParams();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const tabs = ALL_TABS.filter((t) => hasPermission(t.permission));

  // Resolve active tab: honour the URL param, fall back to the first allowed tab.
  const rawTab = params.get('tab');
  const tab =
    tabs.find((t) => t.value === rawTab)?.value ?? tabs[0]?.value ?? 'users';

  function switchTab(value) {
    setParams({ tab: value }, { replace: true });
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
