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
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <ToastViewport />
    </>
  );
}
