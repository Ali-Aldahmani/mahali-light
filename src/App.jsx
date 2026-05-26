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
            path="/settings/printers"
            element={
              <ProtectedRoute permission="settings.view">
                <PrintSettingsPage />
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
