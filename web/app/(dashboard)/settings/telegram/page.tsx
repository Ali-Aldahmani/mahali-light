'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Bot, MessageCircle, Send, Search, CheckCircle2, AlertTriangle, BellRing } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/skeleton';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  getTelegramSettings,
  updateTelegramSettings,
  detectTelegramChat,
  sendTelegramTest,
  type TelegramSettings,
} from '@/services/telegramService';

function Step({
  n,
  done,
  title,
  icon,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'h-7 w-7 shrink-0 rounded-full text-xs font-semibold flex items-center justify-center',
            done ? 'bg-success-light text-success' : 'bg-accent-light text-accent',
          )}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            {icon}
            {title}
          </h2>
          <div className="mt-3 space-y-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function TelegramSettingsInner() {
  const permissions = useAuthStore((s: any) => s.permissions) || [];
  const canEdit = permissions.includes('settings.edit');

  const [s, setS] = useState<TelegramSettings | null>(null);
  const [token, setToken] = useState('');
  const [changingToken, setChangingToken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getTelegramSettings()
      .then(setS)
      .catch((err: any) => toast.error(err?.message || 'Could not load Telegram settings.'));
  }, []);

  async function act(name: string, fn: () => Promise<any>, success?: string) {
    setBusy(name);
    try {
      const res = await fn();
      if (res && 'enabled' in res) setS(res);
      if (success) toast.success(success);
      return res;
    } catch (err: any) {
      toast.error(err?.message || 'Something went wrong.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (!s) {
    return (
      <div className="py-4">
        <Skeleton lines={6} />
      </div>
    );
  }

  const botLink = s.botUsername ? `https://t.me/${s.botUsername}` : null;
  const ready = s.hasToken && !!s.chatId;

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="Telegram alerts"
        subtitle="Get a Telegram message when an item drops to its low-stock threshold."
      />

      {/* Status */}
      <section
        className={cn(
          'rounded-card border p-4 flex flex-wrap items-center gap-x-6 gap-y-3',
          s.enabled ? 'border-success/30 bg-success-light/40' : 'border-border bg-surface',
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <BellRing className={cn('h-5 w-5 shrink-0', s.enabled ? 'text-success' : 'text-ink-muted')} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Low-stock alerts</span>
              <Badge tone={s.enabled ? 'success' : 'muted'} size="sm" dot={s.enabled}>
                {s.enabled ? 'On' : ready ? 'Off' : 'Not set up'}
              </Badge>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              {s.enabled
                ? `Sending to ${s.chatTitle || s.chatId}${s.lastSentAt ? ` · last alert ${formatDateTime(s.lastSentAt)}` : ' · no alerts sent yet'}`
                : 'Finish the steps below, then switch alerts on.'}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button
            variant={s.enabled ? 'secondary' : 'primary'}
            disabled={!ready || !!busy}
            loading={busy === 'toggle'}
            onClick={() =>
              act(
                'toggle',
                () => updateTelegramSettings({ enabled: !s.enabled }),
                s.enabled ? 'Telegram alerts switched off.' : 'Telegram alerts switched on.',
              )
            }
          >
            {s.enabled ? 'Switch off' : 'Switch on'}
          </Button>
        )}
      </section>

      {s.enabled && s.lastError && (
        <div className="rounded-card border border-error/30 bg-error-light/60 p-3 flex items-start gap-2 text-sm text-error">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Last alert could not be sent</div>
            <div className="text-xs mt-0.5">
              {s.lastError}
              {s.lastErrorAt && ` (${formatDateTime(s.lastErrorAt)})`}. It will retry automatically.
            </div>
          </div>
        </div>
      )}

      {/* 1. Token */}
      <Step n={1} done={s.hasToken} title="Connect your bot" icon={<Bot className="h-4 w-4 text-ink-muted" />}>
        {s.hasToken && !changingToken ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-ink">
              Connected to{' '}
              {botLink ? (
                <a href={botLink} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                  @{s.botUsername}
                </a>
              ) : (
                'your bot'
              )}
              <span className="ml-2 text-xs text-ink-muted font-mono">{s.tokenHint}</span>
            </div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setChangingToken(true)}>
                Change bot
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              In Telegram, open <span className="font-medium text-ink">@BotFather</span>, send{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">/newbot</code>, follow the
              prompts, then paste the token it gives you.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
              <div className="flex-1">
                <Input
                  type="password"
                  placeholder="123456789:AA…"
                  value={token}
                  autoComplete="off"
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                />
              </div>
              <Button
                disabled={!canEdit || !token.trim() || !!busy}
                loading={busy === 'token'}
                onClick={async () => {
                  const res = await act('token', () => updateTelegramSettings({ botToken: token.trim() }), 'Bot connected.');
                  if (res) {
                    setToken('');
                    setChangingToken(false);
                  }
                }}
              >
                Connect
              </Button>
              {changingToken && (
                <Button variant="ghost" onClick={() => setChangingToken(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}
      </Step>

      {/* 2. Chat */}
      <Step n={2} done={!!s.chatId} title="Choose where alerts go" icon={<MessageCircle className="h-4 w-4 text-ink-muted" />}>
        <p className="text-sm text-ink-muted">
          Open {botLink ? (
            <a href={botLink} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              @{s.botUsername}
            </a>
          ) : 'your bot'}{' '}
          and press <span className="font-medium text-ink">Start</span>. To alert your whole team, add the bot to a
          staff group and send a message there instead. Then click Find chat.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            leftIcon={<Search className="h-4 w-4" />}
            disabled={!canEdit || !s.hasToken || !!busy}
            loading={busy === 'detect'}
            onClick={() => act('detect', detectTelegramChat, 'Chat found.')}
          >
            Find chat
          </Button>
          {s.chatId && (
            <span className="text-sm text-ink">
              <span className="font-medium">{s.chatTitle || 'Chat'}</span>
              <span className="ml-2 text-xs text-ink-muted font-mono">{s.chatId}</span>
            </span>
          )}
        </div>
      </Step>

      {/* 3. Test */}
      <Step n={3} done={!!s.lastSentAt} title="Send a test message" icon={<Send className="h-4 w-4 text-ink-muted" />}>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            leftIcon={<Send className="h-4 w-4" />}
            disabled={!canEdit || !ready || !!busy}
            loading={busy === 'test'}
            onClick={() => act('test', sendTelegramTest, 'Test message sent. Check Telegram.')}
          >
            Send test
          </Button>
          {!s.enabled && (
            <span className="text-xs text-ink-muted">Then switch alerts on at the top of this page.</span>
          )}
        </div>
      </Step>

      <section className="text-xs text-ink-muted space-y-1 px-1">
        <p className="font-medium text-ink">How alerts work</p>
        <p>
          • An item is watched when it has a low-stock threshold (set on the product or variant). When stock drops to
          the threshold, one message is sent. It won’t repeat until the item is restocked above it and drops again.
        </p>
        <p>• Several items crossing at once arrive together in one message.</p>
        <p>
          • Alerts are sent from the main server PC and need internet there. If the connection drops, they’re sent
          when it comes back.
        </p>
      </section>
    </div>
  );
}

export default function TelegramSettingsPage() {
  return (
    <RequirePermission permission="settings.view">
      <TelegramSettingsInner />
    </RequirePermission>
  );
}
