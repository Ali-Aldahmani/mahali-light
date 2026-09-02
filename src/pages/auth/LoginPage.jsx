import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Lock, User } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { login as loginRequest } from '../../services/authService.js';
import { toast } from '../../store/toastStore.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (token) {
      const from = location.state?.from || '/dashboard';
      navigate(from, { replace: true });
    }
  }, [token, navigate, location.state]);

  function validate() {
    const errs = {};
    if (!username.trim()) errs.username = 'Username is required.';
    if (!password) errs.password = 'Password is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await loginRequest({ username: username.trim(), password });
      toast.success('Signed in successfully');
      let dest = location.state?.from || '/dashboard';
      try {
        const saved = sessionStorage.getItem('mahali.returnRoute');
        if (saved) {
          dest = saved;
          sessionStorage.removeItem('mahali.returnRoute');
        }
      } catch (_e) {
        /* ignore */
      }
      navigate(dest, { replace: true });
    } catch (err) {
      const code = err?.code;
      if (code === 'AUTH_INVALID_CREDENTIALS') {
        setError('Invalid username or password. Please try again.');
      } else if (code === 'AUTH_ACCOUNT_LOCKED') {
        setError('Too many failed attempts. This account is temporarily locked. Try again in 15 minutes.');
      } else if (code === 'AUTH_ACCOUNT_INACTIVE') {
        setError('This account has been deactivated. Contact your administrator.');
      } else if (code === 'NETWORK_ERROR') {
        setError('Cannot reach the server. Check your network connection.');
      } else {
        setError(err?.message || 'Unable to sign in right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-card">
            <Briefcase size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-ink">A1 Smart Light</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Sign in to access the POS terminal
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="card p-6 space-y-4"
          aria-describedby={error ? 'login-error' : undefined}
        >
          {error && (
            <div
              id="login-error"
              role="alert"
              className="rounded-input bg-error-light text-error text-sm px-3 py-2"
            >
              {error}
            </div>
          )}

          <Input
            label="Username"
            placeholder="e.g. admin"
            autoComplete="username"
            autoFocus
            required
            leftIcon={<User size={16} />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fieldErrors.username}
            disabled={loading}
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
            leftIcon={<Lock size={16} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={loading}
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="pt-2 text-center text-xs text-ink-muted">
            Default admin: <span className="font-mono">admin</span> /{' '}
            <span className="font-mono">admin123</span>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          © {new Date().getFullYear()} A1 Smart Light · UAE
        </p>
      </div>
    </div>
  );
}
