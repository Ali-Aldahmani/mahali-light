'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { LoginForm } from '@/hooks/useLoginForm';
import { mobileFontVars } from '../fonts';

const FIELD =
  'h-16 w-full rounded-[14px] border bg-white px-5 font-m-work text-[21px] text-ink placeholder:text-ink-muted outline-none focus:border-m-accent disabled:opacity-60';

export default function MobileLogin({ form }: { form: LoginForm }) {
  const { username, setUsername, password, setPassword, loading, error, fieldErrors, onSubmit } = form;
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const ids = { user: useId(), pass: useId(), userErr: useId(), passErr: useId() };

  return (
    <div
      data-testid="mobile-login"
      className={cn(mobileFontVars, 'min-h-[100dvh] overflow-x-hidden bg-m-bg font-m-work text-ink')}
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      <div className="mx-auto w-full max-w-[440px] px-3">
        <div className="flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mobile/logo-smile.svg" alt="Edara" className="h-[147px] w-[158px]" />
          <h1 className="mt-8 text-center text-[32px] font-normal tracking-[0.96px] text-ink">Welcome back!</h1>
        </div>

        <form onSubmit={onSubmit} noValidate className="mt-14" aria-describedby={error ? 'm-login-error' : undefined}>
          {error && (
            <div id="m-login-error" role="alert" className="mb-4 rounded-[14px] bg-error-light px-4 py-3 text-[15px] text-error">
              {error}
            </div>
          )}

          <label htmlFor={ids.user} className="sr-only">
            Username
          </label>
          <input
            id={ids.user}
            className={cn(FIELD, fieldErrors.username ? 'border-error' : 'border-m-line')}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            aria-invalid={!!fieldErrors.username}
            aria-describedby={fieldErrors.username ? ids.userErr : undefined}
          />
          {fieldErrors.username && (
            <p id={ids.userErr} className="mt-1.5 px-1 text-[14px] text-error">
              {fieldErrors.username}
            </p>
          )}

          <label htmlFor={ids.pass} className="sr-only">
            Password
          </label>
          <div className="relative mt-[21px]">
            <input
              id={ids.pass}
              type={showPassword ? 'text' : 'password'}
              className={cn(FIELD, 'pr-16', fieldErrors.password ? 'border-error' : 'border-m-line')}
              placeholder="Password"
              autoComplete="current-password"
              enterKeyHint="go"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? ids.passErr : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full active:bg-m-field"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mobile/eye.svg" alt="" aria-hidden className={cn('h-[18px] w-[27px]', showPassword && 'opacity-50')} />
            </button>
          </div>
          {fieldErrors.password && (
            <p id={ids.passErr} className="mt-1.5 px-1 text-[14px] text-error">
              {fieldErrors.password}
            </p>
          )}

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              aria-expanded={showForgot}
              className="min-h-[44px] px-1 text-[17px] text-m-accent active:opacity-60"
            >
              Forgot password?
            </button>
          </div>
          {showForgot && (
            <p role="note" className="rounded-[14px] bg-white px-4 py-3 text-[15px] text-ink-muted">
              Passwords are managed by your administrator. Ask them to reset yours.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-12 flex h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-m-accent text-[27px] font-bold text-white active:opacity-80 disabled:opacity-70"
          >
            {loading && <Loader2 aria-hidden className="h-6 w-6 animate-spin" />}
            {loading ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
