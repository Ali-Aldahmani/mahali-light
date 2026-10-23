const { query } = require('../db/postgres');

// =======================================================================
// Telegram stock alerts
//
// When stock crosses an item's reorder threshold, reorderService creates a
// pending reorder_alert. That happens on every stock path (sales, returns,
// adjustments, counts) - but several of them run inside an outer transaction
// and never emit a notification. So instead of hooking the notification
// path, the sender job treats reorder_alerts as an outbox: every few seconds
// it sends pending alerts that haven't gone out yet, then marks them sent.
//   - one message per run (several items are grouped, no spam)
//   - internet down -> keep retrying, nothing is lost or marked
//   - Telegram rejects (bad chat, bot blocked) -> counted, given up after 5
// =======================================================================

const API_BASE = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 30;
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

class TelegramError extends Error {
  // permanent: Telegram answered and said no (4xx). Not permanent: network,
  // timeout, 5xx or rate limit - worth retrying later.
  constructor(message, { permanent = false, status = null } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.permanent = permanent;
    this.status = status;
  }
}

async function callApi(token, method, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    const why = err.name === 'AbortError' ? 'timed out' : err.cause?.code || err.message;
    throw new TelegramError(`Could not reach Telegram (${why}). Check the internet connection.`);
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch (_e) {
    /* non-JSON error page */
  }
  if (res.ok && json?.ok) return json.result;
  const description = json?.description || `HTTP ${res.status}`;
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
  let message = `Telegram: ${description}`;
  if (res.status === 401 || res.status === 404) message = 'Telegram rejected the bot token. Copy it again from @BotFather.';
  else if (/chat not found/i.test(description)) message = 'Telegram cannot find that chat. Use "Find chat" again.';
  else if (/blocked by the user|kicked/i.test(description)) message = 'The bot was blocked or removed from the chat.';
  throw new TelegramError(message, { permanent, status: res.status });
}

const sendMessage = (token, chatId, text) =>
  callApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

// ---------------------------------------------------------------- settings
async function getSettingsRow() {
  const { rows } = await query(`SELECT * FROM telegram_settings WHERE id = 1`);
  return rows[0] || null;
}

function maskToken(token) {
  if (!token) return null;
  const [id] = token.split(':');
  return `${id}:••••${token.slice(-4)}`;
}

// What the browser may see: never the full token.
function publicSettings(row) {
  return {
    enabled: !!row?.enabled,
    hasToken: !!row?.bot_token,
    tokenHint: maskToken(row?.bot_token),
    botUsername: row?.bot_username || null,
    chatId: row?.chat_id || null,
    chatTitle: row?.chat_title || null,
    enabledSince: row?.enabled_since || null,
    lastSentAt: row?.last_sent_at || null,
    lastError: row?.last_error || null,
    lastErrorAt: row?.last_error_at || null,
  };
}

function validationError(message) {
  const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
  return new AppError(ERROR_CODES.VALIDATION_FAILED, message, { status: 400 });
}

// patch: { botToken?, chatId?, enabled? }. A new token is checked with
// Telegram (getMe) before it is saved, and clears the chat (new bot).
async function updateSettings(patch, userId) {
  const row = await getSettingsRow();
  const next = {
    bot_token: row.bot_token,
    bot_username: row.bot_username,
    chat_id: row.chat_id,
    chat_title: row.chat_title,
    enabled: row.enabled,
  };

  if (patch.botToken !== undefined) {
    const token = String(patch.botToken || '').trim();
    if (!token) {
      Object.assign(next, { bot_token: null, bot_username: null, chat_id: null, chat_title: null, enabled: false });
    } else if (token !== row.bot_token) {
      if (!TOKEN_RE.test(token)) throw validationError('That does not look like a bot token (it should look like 123456789:AA…).');
      let me;
      try {
        me = await callApi(token, 'getMe');
      } catch (err) {
        throw validationError(err.message);
      }
      Object.assign(next, { bot_token: token, bot_username: me.username || null, chat_id: null, chat_title: null, enabled: false });
    }
  }
  if (patch.chatId !== undefined) {
    const chat = String(patch.chatId || '').trim();
    if (chat && !/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,}$/.test(chat)) throw validationError('Chat ID should be a number like 123456789 or -1001234567890.');
    if (chat !== (next.chat_id || '')) Object.assign(next, { chat_id: chat || null, chat_title: null });
  }
  if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
  if (next.enabled && (!next.bot_token || !next.chat_id)) {
    throw validationError('Add the bot token and find the chat before turning alerts on.');
  }

  const { rows } = await query(
    `UPDATE telegram_settings
        SET bot_token = $1, bot_username = $2, chat_id = $3, chat_title = $4,
            enabled = $5,
            enabled_since = CASE WHEN $5 AND NOT enabled THEN NOW()
                                 WHEN $5 THEN enabled_since
                                 ELSE NULL END,
            last_error = CASE WHEN $5 THEN last_error ELSE NULL END,
            updated_by = $6, updated_at = NOW()
      WHERE id = 1
      RETURNING *`,
    [next.bot_token, next.bot_username, next.chat_id, next.chat_title, next.enabled, userId || null],
  );
  return publicSettings(rows[0]);
}

// After the owner presses Start in the bot (or adds it to a group), the
// newest update tells us which chat to use.
async function detectChat(userId) {
  const row = await getSettingsRow();
  if (!row?.bot_token) throw validationError('Save the bot token first.');
  let updates;
  try {
    updates = await callApi(row.bot_token, 'getUpdates', { limit: 100, timeout: 0 });
  } catch (err) {
    throw validationError(err.message);
  }
  const chats = (updates || [])
    .map((u) => (u.message || u.edited_message || u.channel_post || u.my_chat_member)?.chat)
    .filter(Boolean);
  const chat = chats[chats.length - 1];
  if (!chat) {
    throw validationError(
      `No messages found. Open @${row.bot_username || 'your bot'} in Telegram, press Start (or send any message), then try again.`,
    );
  }
  const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
  const { rows } = await query(
    `UPDATE telegram_settings SET chat_id = $1, chat_title = $2, updated_by = $3, updated_at = NOW()
      WHERE id = 1 RETURNING *`,
    [String(chat.id), title.slice(0, 200), userId || null],
  );
  return publicSettings(rows[0]);
}

async function storeName() {
  try {
    const { rows } = await query(`SELECT store_name FROM app_settings LIMIT 1`);
    return rows[0]?.store_name || null;
  } catch (_e) {
    return null;
  }
}

async function sendTestMessage() {
  const row = await getSettingsRow();
  if (!row?.bot_token || !row?.chat_id) throw validationError('Add the bot token and find the chat first.');
  const store = await storeName();
  try {
    await sendMessage(
      row.bot_token,
      row.chat_id,
      `✅ <b>Test message${store ? ` from ${escapeHtml(store)}` : ''}</b>\nLow-stock alerts will arrive in this chat.`,
    );
  } catch (err) {
    throw validationError(err.message);
  }
  return { sent: true };
}

// ---------------------------------------------------------------- messages
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const num = (n) => Number(Number(n).toFixed(2)).toString();

function itemLabel(a) {
  const variant = a.variant_label ? ` (${escapeHtml(a.variant_label)})` : '';
  return `<b>${escapeHtml(a.product_name)}</b>${variant}`;
}

function buildStockAlertMessage(alerts, store) {
  const from = store ? ` · ${escapeHtml(store)}` : '';
  const unit = (a) => (a.unit_label ? ` ${escapeHtml(a.unit_label)}` : '');
  if (alerts.length === 1) {
    const a = alerts[0];
    const out = Number(a.stock_qty) <= 0;
    return [
      `${out ? '🔴 <b>Out of stock</b>' : '⚠️ <b>Low stock</b>'}${from}`,
      '',
      itemLabel(a),
      a.sku ? `SKU: <code>${escapeHtml(a.sku)}</code>` : null,
      `In stock: <b>${num(a.stock_qty)}${unit(a)}</b> (alert at ${num(a.reorder_point)})`,
      `Suggested order: ${num(a.recommended_order_qty)}${unit(a)}`,
    ]
      .filter((l) => l !== null)
      .join('\n');
  }
  const lines = alerts.map((a) => {
    const out = Number(a.stock_qty) <= 0;
    return `${out ? '🔴' : '🟠'} ${itemLabel(a)}: ${num(a.stock_qty)}${unit(a)} left (alert at ${num(a.reorder_point)})`;
  });
  return [`⚠️ <b>${alerts.length} items need restocking</b>${from}`, '', ...lines].join('\n');
}

// ---------------------------------------------------------------- sender
let running = false;

async function recordError(message) {
  await query(`UPDATE telegram_settings SET last_error = $1, last_error_at = NOW() WHERE id = 1`, [message]);
}

/**
 * Send every pending, not-yet-sent reorder alert raised since alerts were
 * switched on. Safe to call often; returns what happened for logs/tests.
 */
async function sendPendingStockAlerts() {
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    const row = await getSettingsRow();
    if (!row?.enabled || !row.bot_token || !row.chat_id) return { skipped: 'disabled' };

    const { rows: alerts } = await query(
      `SELECT ra.id, ra.reorder_point, ra.recommended_order_qty,
              v.stock_qty, v.sku, p.name AS product_name, p.unit_label,
              (SELECT string_agg(pav.value, ' / ' ORDER BY pav.sort_order, pav.value)
                 FROM product_variant_attributes pva
                 JOIN product_attribute_values pav ON pav.id = pva.attribute_value_id
                WHERE pva.variant_id = v.id) AS variant_label
         FROM reorder_alerts ra
         JOIN product_variants v ON v.id = ra.variant_id
         JOIN products p ON p.id = ra.product_id
        WHERE ra.status = 'pending'
          AND ra.telegram_sent_at IS NULL
          AND ra.telegram_attempts < $1
          AND ra.created_at >= $2
        ORDER BY ra.created_at
        LIMIT $3`,
      [MAX_ATTEMPTS, row.enabled_since, BATCH_LIMIT],
    );
    if (!alerts.length) return { sent: 0 };

    const ids = alerts.map((a) => a.id);
    try {
      await sendMessage(row.bot_token, row.chat_id, buildStockAlertMessage(alerts, await storeName()));
    } catch (err) {
      if (err.permanent) {
        await query(
          `UPDATE reorder_alerts SET telegram_attempts = telegram_attempts + 1 WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }
      await recordError(err.message);
      return { sent: 0, error: err.message, permanent: !!err.permanent };
    }
    await query(`UPDATE reorder_alerts SET telegram_sent_at = NOW() WHERE id = ANY($1::uuid[])`, [ids]);
    await query(
      `UPDATE telegram_settings SET last_sent_at = NOW(), last_error = NULL, last_error_at = NULL WHERE id = 1`,
    );
    return { sent: alerts.length };
  } finally {
    running = false;
  }
}

module.exports = {
  TelegramError,
  callApi,
  getSettings: async () => publicSettings(await getSettingsRow()),
  updateSettings,
  detectChat,
  sendTestMessage,
  sendPendingStockAlerts,
  // exported for tests
  buildStockAlertMessage,
  maskToken,
  MAX_ATTEMPTS,
};
