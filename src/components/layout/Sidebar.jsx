import { NavLink } from 'react-router-dom';
import { Briefcase, LayoutDashboard, ShieldCheck, UsersRound, UserCog } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { cn } from '../../utils/cn.js';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: null },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'user.edit' },
  { to: '/employees', label: 'Employees', icon: UsersRound, permission: 'employee.view' },
  { to: '/roles', label: 'Roles & Permissions', icon: ShieldCheck, permission: 'user.edit' },
];

export default function Sidebar() {
  const hasPermission = useAuthStore((s) => s.hasPermission);

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-border">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white">
          <Briefcase size={18} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-ink">Mahali Light</p>
          <p className="text-xs text-ink-muted">POS · Phase 1</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV.filter((item) => !item.permission || hasPermission(item.permission)).map(
          ({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
                  isActive
                    ? 'bg-accent-light text-accent'
                    : 'text-ink hover:bg-surface-2',
                )
              }
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ),
        )}
      </nav>

      <div className="px-5 py-3 border-t border-border text-[11px] text-ink-muted">
        v0.1.0 · {new Date().getFullYear()}
      </div>
    </aside>
  );
}
