'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { login as loginRequest } from '@/services/authService';
import { toast } from '@/store/toastStore';

/** Sign-in state + submit shared by the desktop and phone login screens. */
export function useLoginForm({ defaultDest = '/dashboard' }: { defaultDest?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (token) {
      const from = searchParams.get('from') || defaultDest;
      router.replace(from);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function validate() {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = 'Username is required.';
    if (!password) errs.password = 'Password is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await loginRequest({ username: username.trim(), password });
      toast.success('Signed in successfully');
      let dest = searchParams.get('from') || defaultDest;
      try {
        const saved = sessionStorage.getItem('mahali.returnRoute');
        if (saved) {
          dest = saved;
          sessionStorage.removeItem('mahali.returnRoute');
        }
      } catch (_e) {
        /* ignore */
      }
      router.replace(dest);
    } catch (err: any) {
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

  return {
    username,
    setUsername,
    password,
    setPassword,
    loading,
    error,
    fieldErrors,
    onSubmit,
  };
}

export type LoginForm = ReturnType<typeof useLoginForm>;
