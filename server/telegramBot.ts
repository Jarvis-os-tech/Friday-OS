/**
 * Friday OS — Telegram Command Handler (Inbound & Remote Personal AI Manager)
 *
 * Long-polls the Telegram Bot API and handles commands from the user's phone:
 *   /agenda or /today  → Daily priorities, due reminders, active multi-agent schedule
 *   /code <prompt>     → Dispatch coding/testing task directly to Prime Agent
 *   /task <prompt>     → Smart dispatch to Prime Agent, Hermes, or Ultron
 *   /boost             → Ultron kernel performance boost & RAM reclamation
 *   /digest            → Send immediate full morning daily briefing
 *   /status            → System health, active/completed tasks, heartbeat state
 *   /remind <text> <time> → Add a reminder to Friday's memory
 *   <normal text>      → Conversational Personal Manager dialogue via Gemini 3.7 Flash
 *
 * Runs as a 24/7 background service started from server.ts.
 */

import {
  isTelegramConfigured,
  verifyTelegramBot,
  sendTelegramMessage,
  withTypingIndicator,
} from "./telegramNotifier.js";
import { parallelTaskManager } from "./parallelTaskManager.js";
import { getRemindersStore, getDailyScheduleStore, executeSkillByName } from "./skills.js";
import { getHeartbeatStatus, sendMorningDailyDigest } from "./heartbeat.js";
import {
  getBatteryStatus,
  getThermalSensors,
  getSystemTelemetryGroundTruth,
} from "./system_controller.js";
import { execHermes } from "./hermesBridge.js";
import { execPrimeAgent } from "./primeBridge.js";
import { runUltronSystemAction } from "./ultronBridge.js";

// ── Configuration ────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const POLL_INTERVAL_MS = 3000; // 3 seconds between getUpdates calls

// ── State ────────────────────────────────────────────────────────

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let lastUpdateId = 0;
let isPolling = false;

// ── Types ────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
  edited_message?: TelegramUpdate["message"];
}

interface ParsedCommand {
  command: string;
  args: string[];
  rawText: string;
  chatId: number;
  userId: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function parseCommand(text: string, chatId: number, userId: number): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    return { command: cmd, args, rawText: trimmed, chatId, userId };
  }

  return { command: "chat", args: [trimmed], rawText: trimmed, chatId, userId };
}

async function getApiKey(): Promise<string | undefined> {
  let key = process.env.GEMINI_API_KEY;
  if (!key) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const dotenv = await import("dotenv");
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const parsed = dotenv.parse(fs.readFileSync(envPath));
        if (parsed.GEMINI_API_KEY) {
          key = parsed.GEMINI_API_KEY;
          process.env.GEMINI_API_KEY = key;
        }
      }
    } catch {}
  }
  if (key) {
    key = key.replace(/^["']|["']$/g, "").trim();
  }
  return key;
}

function formatSystemStatus(heartbeat: any, battery: any, thermals: any, telemetry: any): string {
  const hb = heartbeat || {};
  const bat = battery || {};
  const therm = thermals || {};
  const tel = telemetry || {};

  let msg = "📊 *Friday OS — 24/7 Status Report*\n\n";

  // Heartbeat & Mode
  msg += `💓 *Autonomous Engine*: ${hb.running ? "🟢 Active 24/7" : "🔴 Stopped"}`;
  if (hb.tickCount) msg += ` (tick #${hb.tickCount})`;
  msg += `\n`;

  // Battery
  if (bat && typeof bat === "object") {
    const level = bat.percentage ?? bat.level ?? bat.capacity ?? "N/A";
    const charging = bat.charging ? "⚡ Charging" : "🔋 On Battery";
    msg += `🔋 *Battery*: ${level}% (${charging})\n`;
  } else {
    msg += "🔋 *Battery*: Desktop (AC Power)\n";
  }

  // Thermals
  if (therm && typeof therm === "object") {
    const entries = Array.isArray(therm) ? therm : Object.values(therm);
    let maxTemp = 0;
    for (const s of entries) {
      const t = typeof s === "number" ? s : (s as any)?.temp ?? (s as any)?.temperature ?? 0;
      if (t > maxTemp) maxTemp = t;
    }
    msg += `🌡️ **Thermals:** Max ${maxTemp}°C\n`;
  }

  // CPU / Memory
  if (tel.cpu !== undefined) msg += `⚙️ **CPU:** ${tel.cpu}%\n`;
  if (tel.memory !== undefined) {
    const mem = tel.memory;
    const used = mem.used ? `${(mem.used / 1024 / 1024 / 1024).toFixed(1)} GB` : "N/A";
    const total = mem.total ? `${(mem.total / 1024 / 1024 / 1024).toFixed(1)} GB` : "N/A";
    msg += `🧠 **Memory:** ${used} / ${total}\n`;
  }

  // Specialist Agents
  msg += `\n🤖 **Specialist Fleet**\n`;
  msg += `• **Prime Agent:** Online (Coding & Testing)\n`;
  msg += `• **Hermes Intelligence:** Online (Research & Vault)\n`;
  msg += `• **Ultron Engine:** Online (OS Optimizer)\n`;

  // Tasks
  const activeTasks = parallelTaskManager.getActiveTasks();
  const completedTasks = parallelTaskManager.getCompletedTasks();
  msg += `\n📋 **Tasks:** ${activeTasks.length} active, ${completedTasks.length} completed\n`;

  return msg;
}

// ── Handlers ─────────────────────────────────────────────────────

async function handleAgendaCommand(chatId: number): Promise<void> {
  try {
    const reminders = getRemindersStore().filter((r) => !r.completed);
    const schedule = getDailyScheduleStore().filter((s) => !s.completed);

    let msg = "📋 **Today's Personal Agenda & Priorities**\n\n";

    if (reminders.length === 0 && schedule.length === 0) {
      msg += "✨ *No pending tasks*. Your agenda is clear and all specialist agents are on standby.\n\nReply with `/code <task>` or `/task <prompt>` to assign work!";
      await sendTelegramMessage(msg);
      return;
    }

    if (schedule.length > 0) {
      msg += "*Scheduled Milestones*:\n";
      schedule.forEach((item, idx) => {
        msg += `${idx + 1}. 🎯 *${item.title}*${item.time ? ` _(${item.time})_` : ""}${item.assignedAgent ? ` ⟶ \`${item.assignedAgent}\`` : ""}\n`;
      });
      msg += "\n";
    }

    if (reminders.length > 0) {
      msg += "*Due Reminders*:\n";
      reminders.forEach((rem, idx) => {
        msg += `${idx + 1}. ⏰ ${rem.text}\n`;
      });
      msg += "\n";
    }

    msg += "_I am tracking your schedule continuously._";
    await sendTelegramMessage(msg);
  } catch (err: any) {
    console.error("[TelegramBot] /agenda error:", err);
    await sendTelegramMessage(`❌ Failed to fetch agenda: ${err.message}`);
  }
}

async function handleCodeCommand(chatId: number, args: string[]): Promise<void> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    await sendTelegramMessage("Usage: `/code <programming task>` — e.g. `/code Write a TypeScript script to fetch crypto prices`");
    return;
  }

  await sendTelegramMessage(`⭐️ *Prime Agent Assigned*\n\nDispatched coding task:\n"${prompt}"\n\nBuilding and testing in background...`);

  try {
    const r = await execPrimeAgent(prompt);
    if (r.success) {
      let reply = `✅ *Prime Agent Completed*\n\n${r.text.slice(0, 3500)}`;
      if (r.codeSnippets && r.codeSnippets.length > 0) {
        reply += `\n\n📦 *Generated ${r.codeSnippets.length} Code Block(s)*`;
      }
      await sendTelegramMessage(reply);
    } else {
      await sendTelegramMessage(`❌ Prime Agent execution notice:\n${r.error || "Failed to complete coding task."}`);
    }
  } catch (err: any) {
    console.error("[TelegramBot] /code error:", err);
    await sendTelegramMessage(`❌ Coding task error: ${err.message || String(err)}`);
  }
}

async function handleBoostCommand(chatId: number): Promise<void> {
  await sendTelegramMessage("⚡ *Engaging Ultron for System Boost...*");
  try {
    const result = await runUltronSystemAction("boost_system");
    const summary = result.speechSummary || result.data?.message || "System boosted successfully.";
    await sendTelegramMessage(`✅ *Ultron Boost Complete*\n\n${summary}`);
  } catch (err: any) {
    console.error("[TelegramBot] /boost error:", err);
    await sendTelegramMessage(`❌ Boost failed: ${err.message}`);
  }
}

async function handleStatusCommand(chatId: number): Promise<void> {
  try {
    const [heartbeat, battery, thermals, telemetry] = await Promise.all([
      getHeartbeatStatus(),
      getBatteryStatus().catch(() => null),
      getThermalSensors().catch(() => null),
      getSystemTelemetryGroundTruth().catch(() => null),
    ]);

    const msg = formatSystemStatus(heartbeat, battery, thermals, telemetry);
    await sendTelegramMessage(msg);
  } catch (err) {
    console.error("[TelegramBot] /status error:", err);
    await sendTelegramMessage("❌ Failed to fetch system status.");
  }
}

async function handleTaskCommand(chatId: number, args: string[]): Promise<void> {
  const prompt = args.join(" ").trim();
  if (!prompt) {
    await sendTelegramMessage("Usage: `/task <your prompt>` — e.g. `/task Research latest developments in multi-agent systems`");
    return;
  }

  const lower = prompt.toLowerCase();
  let assignedAgent = "Hermes Intelligence";

  if (
    lower.includes("code") ||
    lower.includes("program") ||
    lower.includes("script") ||
    lower.includes("python") ||
    lower.includes("typescript") ||
    lower.includes("debug") ||
    lower.includes("refactor") ||
    lower.includes("build")
  ) {
    assignedAgent = "⭐️ Prime Agent";
  } else if (
    lower.includes("boost") ||
    lower.includes("ram") ||
    lower.includes("clean memory") ||
    lower.includes("sound") ||
    lower.includes("audit")
  ) {
    assignedAgent = "🔹 Ultron";
  }

  await sendTelegramMessage(`🚀 *Task Dispatched ⟶ ${assignedAgent}*\n\n${prompt}\n\nI will notify you when complete.`);

  try {
    if (assignedAgent.includes("Prime")) {
      const result = await execPrimeAgent(prompt);
      await sendTelegramMessage(`✅ *Prime Agent Completed*\n\n${result.text.slice(0, 3500)}`);
    } else if (assignedAgent.includes("Ultron")) {
      const result = await runUltronSystemAction("deep_audit");
      await sendTelegramMessage(`✅ *Ultron Audit Complete*\n\n${result.speechSummary || "System audit finished."}`);
    } else {
      const result = await execHermes(prompt, { maxTurns: 12, yolo: true });
      const summary = result.text || result.raw || "Task completed (no output captured).";
      await sendTelegramMessage(`✅ *Hermes Task Complete*\n\n${summary.slice(0, 3500)}`);
    }
  } catch (err: any) {
    console.error("[TelegramBot] /task error:", err);
    await sendTelegramMessage(`❌ Task failed: ${err.message || String(err)}`);
  }
}

async function handleRemindCommand(chatId: number, args: string[]): Promise<void> {
  const full = args.join(" ").trim();
  if (!full) {
    await sendTelegramMessage("Usage: `/remind <text> <time>` — e.g. `/remind Review pull requests in 30m`");
    return;
  }

  const timeKeywords = ["in", "at", "after", "later"];
  let remindText = full;
  let dueInMinutes: number | undefined;

  const words = full.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = words.slice(i).join(" ");
    if (timeKeywords.some((k) => candidate.toLowerCase().startsWith(k))) {
      remindText = words.slice(0, i).join(" ");
      const timeSpec = candidate.toLowerCase();
      if (timeSpec.startsWith("in ")) {
        const duration = timeSpec.slice(3).trim();
        const match = duration.match(/^(\d+)([mhd])$/);
        if (match) {
          const val = parseInt(match[1], 10);
          const unit = match[2];
          dueInMinutes = unit === "m" ? val : unit === "h" ? val * 60 : val * 24 * 60;
        }
      } else if (timeSpec.startsWith("at ")) {
        const timeStr = timeSpec.slice(3).trim();
        const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
        if (match) {
          const hour = parseInt(match[1], 10);
          const minute = parseInt(match[2], 10);
          const now = new Date();
          const target = new Date();
          target.setHours(hour, minute, 0, 0);
          if (target <= now) target.setDate(target.getDate() + 1);
          dueInMinutes = Math.round((target.getTime() - now.getTime()) / 60000);
        }
      }
      break;
    }
  }

  if (!remindText.trim()) {
    await sendTelegramMessage("Please provide reminder text. Usage: `/remind <text> <time>`");
    return;
  }

  try {
    const result = await executeSkillByName("manage_reminders", {
      action: "create",
      text: remindText.trim(),
      due_in_minutes: dueInMinutes,
    });

    if (result.success) {
      await sendTelegramMessage(`⏰ *Reminder Set*\n\n${remindText.trim()}${dueInMinutes ? ` (in ${dueInMinutes} min)` : ""}`);
    } else {
      await sendTelegramMessage(`❌ Failed to set reminder: ${result.data?.error || "Unknown error"}`);
    }
  } catch (err: any) {
    console.error("[TelegramBot] /remind error:", err);
    await sendTelegramMessage(`❌ Reminder error: ${err.message || String(err)}`);
  }
}

async function handleChatCommand(chatId: number, text: string): Promise<void> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      await sendTelegramMessage("❌ Gemini API key not configured on server.");
      return;
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });

    const systemInstruction = `You are F.R.I.D.A.Y., Tony Stark's sophisticated AI voice partner and 24/7 personal manager.
You are chatting with your Boss on Telegram while they are away from their PC.
You have a specialist agent fleet at your command:
- Prime Agent: for all coding, software engineering, building projects, and debugging.
- Hermes: for deep research and Obsidian vault queries.
- Ultron: for OS diagnostics, performance boost, and kernel health.

Tone & Style:
- Professional, razor-sharp, loyal, and proactive.
- Proactively tell the user what to do, what agenda items are pending, and suggest delegating tasks to Prime Agent or Hermes.
- Keep responses concise, clear, and actionable on mobile.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        systemInstruction,
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7,
      },
    });

    const reply = response.text || "...";
    await sendTelegramMessage(reply.slice(0, 4000));
  } catch (err: any) {
    console.error("[TelegramBot] chat error:", err);
    await sendTelegramMessage(`❌ Chat error: ${err.message || String(err)}`);
  }
}

// ── Command Dispatcher ──────────────────────────────────────────

async function dispatchCommand(parsed: ParsedCommand): Promise<void> {
  const { command, args, chatId } = parsed;

  switch (command) {
    case "/agenda":
    case "/today":
      await handleAgendaCommand(chatId);
      break;
    case "/code":
      await handleCodeCommand(chatId, args);
      break;
    case "/task":
      await handleTaskCommand(chatId, args);
      break;
    case "/boost":
      await handleBoostCommand(chatId);
      break;
    case "/digest":
      await sendTelegramMessage("🌅 *Triggering Full Daily Digest...*");
      await sendMorningDailyDigest(true);
      break;
    case "/status":
      await handleStatusCommand(chatId);
      break;
    case "/remind":
      await handleRemindCommand(chatId, args);
      break;
    case "chat":
      await handleChatCommand(chatId, args[0]);
      break;
    default:
      await sendTelegramMessage(
        `Unknown command: ${command}\n\nAvailable Commands:\n/agenda — Today's priorities & schedule\n/code <prompt> — Dispatch coding to Prime Agent\n/task <prompt> — Autonomous multi-agent task\n/boost — Ultron RAM & system boost\n/digest — Trigger morning briefing\n/status — 24/7 system health & fleet status\n/remind <text> <time> — Set reminder\nOr simply message me directly.`
      );
  }
}

// ── Long Polling Loop ────────────────────────────────────────────

async function pollUpdates(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const url = `${TELEGRAM_API_BASE}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok && Array.isArray(result.result)) {
      for (const update of result.result) {
        lastUpdateId = update.update_id;

        const message = update.message || update.edited_message;
        if (!message || !message.text) continue;

        if (process.env.TELEGRAM_CHAT_ID && message.chat.id.toString() !== process.env.TELEGRAM_CHAT_ID) {
          console.warn(`[TelegramBot] Ignoring message from unauthorized chat: ${message.chat.id}`);
          continue;
        }

        const parsed = parseCommand(message.text, message.chat.id, message.from?.id || 0);
        if (parsed) {
          await withTypingIndicator(async () => {
            await dispatchCommand(parsed);
          }, message.chat.id);
        }
      }
    }
  } catch (err) {
    console.error("[TelegramBot] Polling error:", err);
  } finally {
    isPolling = false;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────

export async function startTelegramBot(): Promise<void> {
  if (pollingTimer) {
    console.warn("[TelegramBot] Already running.");
    return;
  }

  // If Python 24/7 gateway is active, delegate Telegram handling to Python core
  try {
    const healthCheck = await fetch("http://127.0.0.1:8001/health", { signal: AbortSignal.timeout(600) });
    if (healthCheck.ok) {
      console.log("[TelegramBot] 🐍 Python 24/7 Gateway daemon is active on port 8001. Telegram polling delegated to Python core.");
      return;
    }
  } catch {}

  if (!isTelegramConfigured()) {
    console.log("[TelegramBot] Not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
    return;
  }

  const botCheck = await verifyTelegramBot();
  if (!botCheck.ok) {
    console.warn(`[TelegramBot] Bot verification failed: ${botCheck.error}`);
    return;
  }

  console.log(`[TelegramBot] 🤖 Connected as ${botCheck.botName}. Starting long-poll...`);

  try {
    const initResp = await fetch(`${TELEGRAM_API_BASE}/getUpdates?limit=1`);
    const initResult = await initResp.json();
    if (initResult.ok && initResult.result.length > 0) {
      lastUpdateId = initResult.result[0].update_id;
    }
  } catch {}

  pollingTimer = setInterval(pollUpdates, POLL_INTERVAL_MS);
}

export function stopTelegramBot(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log("[TelegramBot] Stopped.");
  }
}

export function getTelegramBotStatus() {
  return {
    running: pollingTimer !== null,
    pollingIntervalMs: POLL_INTERVAL_MS,
    lastUpdateId,
    configured: isTelegramConfigured(),
  };
}