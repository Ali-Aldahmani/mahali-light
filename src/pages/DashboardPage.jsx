import {
  Boxes,
  Building2,
  FolderTree,
  Package,
  Receipt,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Truck,
  UserCog,
  Users,
  UsersRound,
  Wallet,
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
        subtitle="Phases 1–6 — Auth, Catalog, Inventory, Procurement, Customers and POS are live."
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
        <PermissionGate permission="stock.view">
          <StatCard
            icon={Boxes}
            label="Inventory"
            value="Stock, counts & alerts"
            to="/inventory"
          />
        </PermissionGate>
        <PermissionGate permission="supplier.view">
          <StatCard
            icon={Building2}
            label="Suppliers"
            value="Vendors & balances"
            to="/suppliers"
          />
        </PermissionGate>
        <PermissionGate permission="supplier.view">
          <StatCard
            icon={Truck}
            label="Purchase orders"
            value="Issue, receive & pay"
            to="/purchase-orders"
          />
        </PermissionGate>
        <PermissionGate permission="invoice.create">
          <StatCard
            icon={ShoppingCart}
            label="POS"
            value="Start a sale"
            to="/pos"
          />
        </PermissionGate>
        <PermissionGate permission="invoice.view">
          <StatCard
            icon={Receipt}
            label="Invoices"
            value="Sales & payments"
            to="/invoices"
          />
        </PermissionGate>
        <PermissionGate permission="customer.view">
          <StatCard
            icon={Users}
            label="Customers"
            value="Profiles & credit"
            to="/customers"
          />
        </PermissionGate>
        <PermissionGate permission="customer.view_balance">
          <StatCard
            icon={Wallet}
            label="Receivables"
            value="Outstanding balances"
            to="/customers/outstanding"
          />
        </PermissionGate>
        <PermissionGate permission="warranty.view">
          <StatCard
            icon={Shield}
            label="Warranty lookup"
            value="Find by serial / customer"
            to="/warranties/lookup"
          />
        </PermissionGate>
        <PermissionGate permission="warranty.view">
          <StatCard
            icon={ShieldAlert}
            label="Warranty claims"
            value="Open & in progress"
            to="/warranty-claims"
          />
        </PermissionGate>
        <PermissionGate permission="return.request">
          <StatCard
            icon={RotateCcw}
            label="Returns"
            value="Refunds & replacements"
            to="/returns"
          />
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
          POS, invoicing, warranties and returns are live — open <strong>POS</strong> to
          ring up a sale, head to <strong>Returns</strong> for refunds &amp;
          replacements, or open <strong>Warranties</strong> to track customer
          coverage. Subsequent phases add attendance, cash &amp; bank, finance
          and reporting.
        </p>
      </div>
    </div>
  );
}
