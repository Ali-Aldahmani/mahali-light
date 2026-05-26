import {
  FolderTree,
  Package,
  ShieldCheck,
  Sliders,
  UserCog,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import { useAuthStore } from '../store/authStore.js';
import PermissionGate from '../components/ui/PermissionGate.jsx';

function StatCard({ icon: Icon, label, value, to }) {
  const body = (
    <div className="card p-5 hover:border-accent hover:shadow-pop transition">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
          <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
        </div>
        <div className="h-10 w-10 inline-flex items-center justify-center rounded-lg bg-accent-light text-accent">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.username || 'user'}`}
        subtitle="Phase 1 — Auth & Users module is live."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <PermissionGate permission="product.view">
          <StatCard icon={Package} label="Products" value="Catalog & variants" to="/products" />
        </PermissionGate>
        <PermissionGate permission="product.view">
          <StatCard icon={FolderTree} label="Categories" value="Tree & attributes" to="/categories" />
        </PermissionGate>
        <PermissionGate permission="product.view">
          <StatCard icon={Sliders} label="Attributes" value="Reusable specs" to="/attributes" />
        </PermissionGate>
        <PermissionGate permission="user.edit">
          <StatCard icon={UserCog} label="Users" value="Manage accounts" to="/users" />
        </PermissionGate>
        <PermissionGate permission="employee.view">
          <StatCard
            icon={UsersRound}
            label="Employees"
            value="Manage records"
            to="/employees"
          />
        </PermissionGate>
        <PermissionGate permission="user.edit">
          <StatCard
            icon={ShieldCheck}
            label="Roles"
            value="Permissions matrix"
            to="/roles"
          />
        </PermissionGate>
      </div>

      <div className="mt-8 card p-6">
        <h2 className="text-base font-semibold text-ink">Coming next</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Subsequent phases will add the POS, inventory adjustments, customers, suppliers,
          attendance, finance and reporting modules. The catalog and permissions layer
          you see here is the foundation for all of them.
        </p>
      </div>
    </div>
  );
}
