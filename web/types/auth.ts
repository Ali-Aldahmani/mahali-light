export type RoleName = 'Admin' | 'Manager' | 'Cashier' | 'Employee' | string;

export interface Permission {
  key: string;
  label?: string;
  category?: string;
}

export interface User {
  id: number | string;
  username: string;
  full_name?: string;
  role: RoleName;
  permissions: string[];
  is_active?: boolean;
  avatar_url?: string | null;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  permissions: string[];
  isAuthenticated: () => boolean;
  hasPermission: (key?: string | null) => boolean;
  hasAnyPermission: (keys?: string[]) => boolean;
  setSession: (payload: { token: string; user: User }) => void;
  setUser: (user: User | null) => void;
  logoutLocal: () => void;
}

export interface LoginCredentials {
  username: string;
  password: string;
}
