import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/auth/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import UsersPage from './pages/users/UsersPage.jsx';
import EmployeesPage from './pages/users/EmployeesPage.jsx';
import RolesPage from './pages/users/RolesPage.jsx';
import RolePermissionsPage from './pages/users/RolePermissionsPage.jsx';
import ProductsPage from './pages/products/ProductsPage.jsx';
import NewProductPage from './pages/products/NewProductPage.jsx';
import ProductDetailPage from './pages/products/ProductDetailPage.jsx';
import CategoriesPage from './pages/products/CategoriesPage.jsx';
import AttributesPage from './pages/products/AttributesPage.jsx';
import InventoryPage from './pages/inventory/InventoryPage.jsx';
import StockMovementsPage from './pages/inventory/StockMovementsPage.jsx';
import StockCountDetailPage from './pages/inventory/StockCountDetailPage.jsx';
import SuppliersPage from './pages/suppliers/SuppliersPage.jsx';
import SupplierProfilePage from './pages/suppliers/SupplierProfilePage.jsx';
import PurchaseOrdersPage from './pages/purchases/PurchaseOrdersPage.jsx';
import NewPurchaseOrderPage from './pages/purchases/NewPurchaseOrderPage.jsx';
import PurchaseOrderDetailPage from './pages/purchases/PurchaseOrderDetailPage.jsx';
import CustomersPage from './pages/customers/CustomersPage.jsx';
import CustomerProfilePage from './pages/customers/CustomerProfilePage.jsx';
import OutstandingReceivablesPage from './pages/customers/OutstandingReceivablesPage.jsx';
import POSPage from './pages/pos/POSPage.jsx';
import InvoicesPage from './pages/invoices/InvoicesPage.jsx';
import InvoiceDetailPage from './pages/invoices/InvoiceDetailPage.jsx';
import InvoiceEditRequestsPage from './pages/invoices/InvoiceEditRequestsPage.jsx';
import PrintSettingsPage from './pages/settings/PrintSettingsPage.jsx';
import WarrantyLookupPage from './pages/warranties/WarrantyLookupPage.jsx';
import WarrantiesPage from './pages/warranties/WarrantiesPage.jsx';
import WarrantyDetailPage from './pages/warranties/WarrantyDetailPage.jsx';
import WarrantyClaimsPage from './pages/warranties/WarrantyClaimsPage.jsx';
import WarrantyClaimDetailPage from './pages/warranties/WarrantyClaimDetailPage.jsx';
import ReturnsPage from './pages/returns/ReturnsPage.jsx';
import NewReturnRequestPage from './pages/returns/NewReturnRequestPage.jsx';
import ReturnRequestDetailPage from './pages/returns/ReturnRequestDetailPage.jsx';
import ReturnOrderDetailPage from './pages/returns/ReturnOrderDetailPage.jsx';
import TreasuryPage from './pages/treasury/TreasuryPage.jsx';
import AttendancePage from './pages/attendance/AttendancePage.jsx';
import LeaveBalancesPage from './pages/attendance/LeaveBalancesPage.jsx';
import HolidaysPage from './pages/attendance/HolidaysPage.jsx';
import ExpensesPage from './pages/expenses/ExpensesPage.jsx';
import BillDetailPage from './pages/expenses/BillDetailPage.jsx';
import FinancePage from './pages/finance/FinancePage.jsx';
import JournalPage from './pages/finance/JournalPage.jsx';
import AccountsPage from './pages/finance/AccountsPage.jsx';
import PeriodsPage from './pages/finance/PeriodsPage.jsx';
import ReportsHubPage from './pages/reports/ReportsHubPage.jsx';
import ReportPage from './pages/reports/ReportPage.jsx';
import NetProfitPage from './pages/reports/NetProfitPage.jsx';
import ScheduledReportsPage from './pages/reports/ScheduledReportsPage.jsx';
import AnalyticsPage from './pages/analytics/AnalyticsPage.jsx';
import ApprovalsPage from './pages/approvals/ApprovalsPage.jsx';
import NotificationPreferencesPage from './pages/settings/NotificationPreferencesPage.jsx';
import BackupSettingsPage from './pages/settings/BackupSettingsPage.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ToastViewport from './components/ui/Toast.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route
            path="/users"
            element={
              <ProtectedRoute permission="user.edit">
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/employees"
            element={
              <ProtectedRoute permission="employee.view">
                <EmployeesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/roles"
            element={
              <ProtectedRoute permission="user.edit">
                <RolesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/roles/:id/permissions"
            element={
              <ProtectedRoute permission="user.change_role">
                <RolePermissionsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/products"
            element={
              <ProtectedRoute permission="product.view">
                <ProductsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products/new"
            element={
              <ProtectedRoute permission="product.create">
                <NewProductPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products/:id"
            element={
              <ProtectedRoute permission="product.view">
                <ProductDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/categories"
            element={
              <ProtectedRoute permission="product.view">
                <CategoriesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attributes"
            element={
              <ProtectedRoute permission="product.view">
                <AttributesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/inventory"
            element={
              <ProtectedRoute permission="stock.view">
                <InventoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory/movements"
            element={
              <ProtectedRoute permission="stock.view">
                <StockMovementsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory/counts/:id"
            element={
              <ProtectedRoute permission="stock.view">
                <StockCountDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/suppliers"
            element={
              <ProtectedRoute permission="supplier.view">
                <SuppliersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/suppliers/:id"
            element={
              <ProtectedRoute permission="supplier.view">
                <SupplierProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders"
            element={
              <ProtectedRoute permission="supplier.view">
                <PurchaseOrdersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/new"
            element={
              <ProtectedRoute permission="supplier.purchase_order.create">
                <NewPurchaseOrderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchase-orders/:id"
            element={
              <ProtectedRoute permission="supplier.view">
                <PurchaseOrderDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/customers"
            element={
              <ProtectedRoute permission="customer.view">
                <CustomersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers/outstanding"
            element={
              <ProtectedRoute permission="customer.view_balance">
                <OutstandingReceivablesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <ProtectedRoute permission="customer.view">
                <CustomerProfilePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/pos"
            element={
              <ProtectedRoute permission="invoice.create">
                <POSPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices"
            element={
              <ProtectedRoute permission="invoice.view">
                <InvoicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/edit-requests"
            element={
              <ProtectedRoute permission="invoice.edit_approve">
                <InvoiceEditRequestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <ProtectedRoute permission="invoice.view">
                <InvoiceDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/warranties/lookup"
            element={
              <ProtectedRoute permission="warranty.view">
                <WarrantyLookupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranties"
            element={
              <ProtectedRoute permission="warranty.view">
                <WarrantiesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranties/:id"
            element={
              <ProtectedRoute permission="warranty.view">
                <WarrantyDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranty-claims"
            element={
              <ProtectedRoute permission="warranty.view">
                <WarrantyClaimsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/warranty-claims/:id"
            element={
              <ProtectedRoute permission="warranty.view">
                <WarrantyClaimDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/returns"
            element={
              <ProtectedRoute permission="return.request">
                <ReturnsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/returns/new"
            element={
              <ProtectedRoute permission="return.request">
                <NewReturnRequestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/returns/requests/:id"
            element={
              <ProtectedRoute permission="return.request">
                <ReturnRequestDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/returns/orders/:id"
            element={
              <ProtectedRoute permission="return.request">
                <ReturnOrderDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/printers"
            element={
              <ProtectedRoute permission="settings.view">
                <PrintSettingsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/treasury"
            element={
              <ProtectedRoute permission="cash.view">
                <TreasuryPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/attendance"
            element={
              <ProtectedRoute permission="attendance.view_own">
                <AttendancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance/leave-balances"
            element={
              <ProtectedRoute permission="attendance.view_all">
                <LeaveBalancesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance/holidays"
            element={
              <ProtectedRoute permission="attendance.view_own">
                <HolidaysPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/expenses"
            element={
              <ProtectedRoute permission="bills.view">
                <ExpensesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/expenses/bills/:id"
            element={
              <ProtectedRoute permission="bills.view">
                <BillDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/finance"
            element={
              <ProtectedRoute permission="finance.view_dashboard">
                <FinancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/journal"
            element={
              <ProtectedRoute permission="finance.view_journal">
                <JournalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/journal/:id"
            element={
              <ProtectedRoute permission="finance.view_journal">
                <JournalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/accounts"
            element={
              <ProtectedRoute permission="finance.view_journal">
                <AccountsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/periods"
            element={
              <ProtectedRoute permission="finance.view_journal">
                <PeriodsPage />
              </ProtectedRoute>
            }
          />

          <Route path="/reports" element={<ReportsHubPage />} />
          <Route path="/reports/net-profit" element={<NetProfitPage />} />
          <Route
            path="/reports/scheduled"
            element={
              <ProtectedRoute permission="report.schedule">
                <ScheduledReportsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/reports/:category/:type" element={<ReportPage />} />

          <Route
            path="/analytics"
            element={
              <ProtectedRoute permission="analytics.view">
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/approvals"
            element={
              <ProtectedRoute>
                <ApprovalsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/notifications"
            element={
              <ProtectedRoute>
                <NotificationPreferencesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/backup"
            element={
              <ProtectedRoute permission="backup.view">
                <BackupSettingsPage />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <ToastViewport />
    </>
  );
}
