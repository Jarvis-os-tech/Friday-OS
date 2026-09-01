/**
 * Friday OS — Telegram Notification Service
 *
 * Sends notifications to the user's personal Telegram when Friday
 * has something to report and the user is not at the browser.
 *
 * Zero dependencies — uses native fetch() with the Telegram Bot API.
 *
 * Setup:
 *   1. Message @BotFather on Telegram → /newbot → get the bot token
 *   2. Message your bot, then visit:
 *      https://api.telegram.org/bot<TOKEN>/getUpdates
 *      → Find your chat_id in the response
 *   3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
 */

// ── Configuration ───────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Rate limiting: max 1 message per 3 seconds (Telegram limit is 30/sec, but we're conservative)
let lastSentAt = 0;
const MIN_INTERVAL_MS = 3000;

// ── Types ───────────────────────────────────────────────────────

export type TelegramMessagePriority = "low" | "normal" | "high" | "critical";

export interface TelegramNotification {
  title: string;
  body: string;
  priority?: TelegramMessagePriority;
  category?: string;
  /** Optional URL to include as an inline button */
  actionUrl?: string;
  actionLabel?: string;
}

// ── Core Functions ──────────────────────────────────────────────

/**
 * Check if Telegram notifications are configured and ready to use.
 */
export function isTelegramConfigured(): boolean {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

/**
 * Format a notification into a Telegram-friendly message with emoji and markdown.
 */
function formatMessage(notification: TelegramNotification): string {
  const priorityEmoji: Record<TelegramMessagePriority, string> = {
    low: "📋",
    normal: "📌",
    high: "⚡",
    critical: "🚨",
  };

  const emoji = priorityEmoji[notification.priority || "normal"];
  const category = notification.category ? `\`${notification.category}\`` : "";
  const header = `${emoji} *${escapeMarkdown(notification.title)}*`;
  const categoryLine = category ? `  ${category}` : "";

  let msg = `${header}${categoryLine}\n\n${escapeMarkdown(notification.body)}`;

  // Add timestamp
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  msg += `\n\n🕐 _${timeStr} IST_`;

  return msg;
}

/**
 * Escape special characters for Telegram MarkdownV2.
 */
function escapeMarkdown(text: string): string {
  // MarkdownV2 requires escaping these characters
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send a notification to the user's Telegram.
 * Returns true if sent successfully, false otherwise.
 */
export async function sendTelegramNotification(
  notification: TelegramNotification
): Promise<boolean> {
  if (!isTelegramConfigured()) {
    console.warn(
      "[Telegram] Not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env"
    );
    return false;
  }

  // Rate limiting
  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS) {
    const delay = MIN_INTERVAL_MS - (now - lastSentAt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const message = formatMessage(notification);

  try {
    const payload: any = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "MarkdownV2",
      disable_notification: notification.priority === "low",
    };

    // Add inline keyboard button if action URL is provided
    if (notification.actionUrl) {
      payload.reply_markup = JSON.stringify({
        inline_keyboard: [
          [
            {
              text: notification.actionLabel || "Open",
              url: notification.actionUrl,
            },
          ],
        ],
      });
    }

    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.ok) {
      lastSentAt = Date.now();
      console.log(
        `[Telegram] ✉️  Notification sent: "${notification.title}"`
      );
      return true;
    } else {
      console.error(
        `[Telegram] API error: ${result.description || JSON.stringify(result)}`
      );
      // Fallback: try without MarkdownV2 if parsing fails
      if (result.description?.includes("can't parse")) {
        return sendTelegramPlaintext(notification);
      }
      return false;
    }
  } catch (error) {
    console.error(`[Telegram] Send failed:`, error);
    return false;
  }
}

/**
 * Fallback: send as plain text if MarkdownV2 parsing fails.
 */
async function sendTelegramPlaintext(
  notification: TelegramNotification
): Promise<boolean> {
  try {
    const text = `${notification.title}\n\n${notification.body}`;
    const response = await fetch(`${TELEGRAM_API_BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        disable_notification: notification.priority === "low",
      }),
    });

    const result = await response.json();
    if (result.ok) {
      lastSentAt = Date.now();
      console.log(
        `[Telegram] ✉️  Notification sent (plaintext fallback): "${notification.title}"`
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Convenience: send a simple text message to Telegram.
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  return sendTelegramNotification({
    title: "Friday",
    body: text,
    priority: "normal",
  });
}

/**
 * Send a task completion notification to Telegram.
 */
export async function notifyTaskComplete(
  taskTitle: string,
  summary: string,
  durationMs?: number
): Promise<boolean> {
  const durationStr = durationMs
    ? `${(durationMs / 1000).toFixed(1)}s`
    : "unknown";

  return sendTelegramNotification({
    title: `✅ Task Complete: ${taskTitle}`,
    body: `${summary}\n\nDuration: ${durationStr}`,
    priority: "normal",
    category: "task",
  });
}

/**
 * Send a proactive alert to Telegram (system health, reminders, etc).
 */
export async function notifyProactiveAlert(
  alertTitle: string,
  details: string,
  priority: TelegramMessagePriority = "high"
): Promise<boolean> {
  return sendTelegramNotification({
    title: alertTitle,
    body: details,
    priority,
    category: "proactive",
  });
}

/**
 * Verify Telegram bot connectivity. Returns bot info on success.
 */
export async function verifyTelegramBot(): Promise<{
  ok: boolean;
  botName?: string;
  error?: string;
}> {
  if (!isTelegramConfigured()) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env" };
  }

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/getMe`);
    const result = await response.json();
    if (result.ok) {
      return {
        ok: true,
        botName: result.result.first_name || result.result.username,
      };
    }
    return { ok: false, error: result.description };
  } catch (error: any) {
    return { ok: false, error: error.message || String(error) };
  }
}
