import { apiGet, apiPost, apiPut } from './http';

export interface TelegramSettings {
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  botUsername: string | null;
  chatId: string | null;
  chatTitle: string | null;
  enabledSince: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export function getTelegramSettings() {
  return apiGet<TelegramSettings>('/integrations/telegram');
}

export function updateTelegramSettings(patch: { botToken?: string; chatId?: string; enabled?: boolean }) {
  return apiPut<TelegramSettings>('/integrations/telegram', patch);
}

export function detectTelegramChat() {
  return apiPost<TelegramSettings>('/integrations/telegram/detect-chat');
}

export function sendTelegramTest() {
  return apiPost<{ sent: boolean }>('/integrations/telegram/test');
}
