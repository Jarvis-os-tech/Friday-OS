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

const getBotToken = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const getChatId = () => (process.env.TELEGRAM_CHAT_ID || "").trim();
const getApiBase = () => `https://api.telegram.org/bot${getBotToken()}`;

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
  return !!(getBotToken() && getChatId());
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
  const categoryStr = notification.category ? `[${notification.category.toUpperCase()}] ` : "";
  const header = `${emoji} **${escapeMarkdown(categoryStr)}${escapeMarkdown(notification.title)}**`;

  let msg = `${header}\n\n${escapeMarkdown(notification.body)}`;

  // Add clean timestamp
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  msg += `\n\n*${timeStr} IST*`;

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
  notification: TelegramNotification,
  chatId?: string | number
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
  const targetChatId = chatId ? String(chatId) : getChatId();

  try {
    const payload: any = {
      chat_id: targetChatId,
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

    const response = await fetch(`${getApiBase()}/sendMessage`, {
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
        return sendTelegramPlaintext(notification, targetChatId);
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
  notification: TelegramNotification,
  chatId?: string | number
): Promise<boolean> {
  try {
    const text = `${notification.title}\n\n${notification.body}`;
    const targetChatId = chatId ? String(chatId) : getChatId();
    const response = await fetch(`${getApiBase()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
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
export async function sendTelegramMessage(text: string, chatId?: string | number): Promise<boolean> {
  return sendTelegramNotification(
    {
      title: "Friday",
      body: text,
      priority: "normal",
    },
    chatId
  );
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
    ? `Completed in ${(durationMs / 1000).toFixed(1)}s`
    : "";

  return sendTelegramNotification({
    title: `Task Complete`,
    body: `✅ **${taskTitle}**\n\n${summary}${durationStr ? `\n\n*${durationStr}*` : ""}`,
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
  });
}

/**
 * Send a chat action (typing, upload_document, etc.) to Telegram.
 * Telegram typing indicators last ~5 seconds.
 */
export async function sendTelegramChatAction(
  action: string = "typing",
  chatId?: string | number
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const targetChatId = chatId ? String(chatId) : getChatId();

  try {
    const response = await fetch(`${getApiBase()}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
        action,
      }),
    });
    const result = await response.json();
    return Boolean(result.ok);
  } catch (error) {
    console.debug("[Telegram] sendChatAction error:", error);
    return false;
  }
}

/**
 * Start a continuous typing indicator loop that refreshes every 4 seconds.
 * Returns a stop function.
 */
export function startTypingIndicator(
  chatId?: string | number,
  intervalMs: number = 4000
): () => void {
  sendTelegramChatAction("typing", chatId).catch(() => {});
  const timer = setInterval(() => {
    sendTelegramChatAction("typing", chatId).catch(() => {});
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}

/**
 * Convenience wrapper: executes an async action while continuously showing typing indicator.
 */
export async function withTypingIndicator<T>(
  action: () => Promise<T>,
  chatId?: string | number
): Promise<T> {
  const stopTyping = startTypingIndicator(chatId);
  try {
    return await action();
  } finally {
    stopTyping();
  }
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
    const response = await fetch(`${getApiBase()}/getMe`);
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
