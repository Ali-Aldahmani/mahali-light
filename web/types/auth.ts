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
  /** Same for the whole sign-in; a token refresh doesn't change it. */
  sessionKey: string | null;
  /** Minutes without input before the server signs this session out (0 = never). */
  idleSignOutMinutes: number;
  isAuthenticated: () => boolean;
  hasPermission: (key?: string | null) => boolean;
  hasAnyPermission: (keys?: string[]) => boolean;
  setSession: (payload: { token: string; user: User; idleSignOutMinutes?: number }) => void;
  /** A refreshed token for the same session. */
  setToken: (token: string) => void;
  setUser: (user: User | null) => void;
  logoutLocal: () => void;
}

export interface LoginCredentials {
  username: string;
  password: string;
}
