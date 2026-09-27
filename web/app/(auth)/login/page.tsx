'use client';

import { Briefcase, Lock, User } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import MobileLogin from '@/components/mobile/screens/MobileLogin';
import { useLoginForm } from '@/hooks/useLoginForm';
import { useDeviceClass } from '@/lib/mobile/device';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';

export default function LoginPage() {
  const device = useDeviceClass();
  const form = useLoginForm({ defaultDest: device === 'phone' ? MOBILE_HOME : '/dashboard' });
  const { username, setUsername, password, setPassword, loading, error, fieldErrors, onSubmit } = form;

  if (device === 'unknown') return null;
  if (device === 'phone') return <MobileLogin form={form} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-card">
            <Briefcase size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-ink">Mahali Light</h1>
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
            onChange={(e: any) => setUsername(e.target.value)}
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
            onChange={(e: any) => setPassword(e.target.value)}
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
        </form>

        <p className="mt-6 text-center text-xs text-ink-muted">
          © {new Date().getFullYear()} Mahali Light · UAE
        </p>
      </div>
    </div>
  );
}
