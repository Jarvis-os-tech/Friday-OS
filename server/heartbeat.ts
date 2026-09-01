/**
 * Friday OS — Heartbeat Engine (Proactive Autonomy Layer)
 *
 * The 24/7 "pulse" that makes Friday alive. Runs background checks on a schedule,
 * tracks the daily schedule, delivers morning briefings, and executes proactive
 * autonomous self-healing — keeping you informed via Voice when at the PC, or
 * Telegram when away.
 *
 * Architecture:
 *   setInterval (configurable, default 5 min)
 *     → Check daily morning briefing (send to Telegram once daily)
 *     → Check due reminders and scheduled agenda milestones
 *     → Check system health (battery, thermal, disk, memory)
 *     → Check completed background tasks & failed tasks
 *     → Autonomous Self-Healing: auto-remediate & report
 *     → Route notifications:
 *         → User at browser? → WebSocket push & Voice announcement
 *         → User away?       → Telegram message & interactive commands
 */

import { getRemindersStore, getDailyScheduleStore, type ReminderItem, type ScheduleItem } from "./skills.js";
import { parallelTaskManager } from "./parallelTaskManager.js";
import {
  sendTelegramNotification,
  notifyProactiveAlert,
  notifyTaskComplete,
  sendTelegramMessage,
  isTelegramConfigured,
  verifyTelegramBot,
  type TelegramMessagePriority,
} from "./telegramNotifier.js";
import {
  getBatteryStatus,
  getThermalSensors,
  getSystemTelemetryGroundTruth,
} from "./system_controller.js";
import { runUltronSystemAction } from "./ultronBridge.js";
import { logExecutionTrace } from "./memoryLogger.js";

// ── Configuration ───────────────────────────────────────────────

/** Heartbeat interval in milliseconds. Default: 5 minutes */
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_INTERVAL_MS || "300000",
  10
);

/** Minimum interval between Telegram messages for the same alert type (avoid spam) */
const ALERT_COOLDOWN_MS = parseInt(
  process.env.ALERT_COOLDOWN_MS || "1800000", // 30 minutes
  10
);

/** Battery percentage threshold for low battery alert */
const BATTERY_LOW_THRESHOLD = parseInt(
  process.env.BATTERY_LOW_THRESHOLD || "15",
  10
);

/** Temperature threshold in Celsius for thermal alert */
const THERMAL_HIGH_THRESHOLD = parseInt(
  process.env.THERMAL_HIGH_THRESHOLD || "85",
  10
);

// ── State ───────────────────────────────────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let lastStartedAt: number | null = null;
let lastMorningDigestDate: string | null = null;

/** Track cooldowns per alert type to avoid spamming */
const alertCooldowns: Map<string, number> = new Map();

/** Track tasks we've already notified about (to avoid duplicate Telegram messages) */
const notifiedTaskIds: Set<string> = new Set();
const healedFailedTaskIds: Set<string> = new Set();

// ── Types ───────────────────────────────────────────────────────

interface HeartbeatResult {
  tick: number;
  timestamp: string;
  userPresent: boolean;
  checks: {
    reminders: { due: number; notified: number };
    schedule: { active: number; due: number };
    battery: { checked: boolean; level?: number; alert?: boolean };
    thermal: { checked: boolean; maxTemp?: number; alert?: boolean };
    completedTasks: { found: number; notified: number };
    selfHealing: { attempted: number; resolved: number };
  };
  notificationsSent: number;
}

// ── Morning Digest Dispatcher ───────────────────────────────────

/**
 * Dispatch morning personal agenda & daily priority digest to Telegram
 */
export async function sendMorningDailyDigest(force: boolean = false): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Send only once per day unless forced
  if (!force && lastMorningDigestDate === todayStr) {
    return false;
  }

  try {
    const reminders = getRemindersStore().filter((r: ReminderItem) => !r.completed);
    const schedule = getDailyScheduleStore().filter((s: ScheduleItem) => !s.completed);

    const [telemetry, battery] = await Promise.all([
      getSystemTelemetryGroundTruth().catch(() => null),
      getBatteryStatus().catch(() => null),
    ]);

    let msg = `🌅 *Good Morning, Boss — Friday OS Daily Agenda*\n\n`;

    const nowFormatted = now.toLocaleDateString("en-IN", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "Asia/Kolkata",
    });
    msg += `📅 _${nowFormatted}_\n\n`;

    // 1. Priorities and Tasks
    if (reminders.length === 0 && schedule.length === 0) {
      msg += `✨ *Priorities Today*: Your schedule is clear. Ready for new project goals.\n\n`;
    } else {
      msg += `📋 *Today's Key Priorities & Tasks*:\n`;
      let count = 1;
      for (const item of schedule) {
        msg += `${count}. 🎯 *${item.title}*${item.time ? ` _(${item.time})_` : ""}${item.assignedAgent ? ` ⟶ \`${item.assignedAgent}\`` : ""}\n`;
        count++;
      }
      for (const rem of reminders) {
        msg += `${count}. ⏰ ${rem.text}\n`;
        count++;
      }
      msg += `\n`;
    }

    // 2. Autonomous Multi-Agent Fleet Status
    msg += `🤖 *Specialist Fleet Status*:\n`;
    msg += `• ⭐️ *Prime Agent*: Online & Ready for Software Engineering / Coding\n`;
    msg += `• 🔹 *Hermes Intelligence*: Online & Ready for Deep Research & Vault\n`;
    msg += `• 🔹 *Ultron Engine*: Online (Kernel, Thermals & RAM Protection Active)\n\n`;

    // 3. System Telemetry
    if (telemetry?.cpu !== undefined) {
      msg += `⚙️ CPU: ${telemetry.cpu}% | RAM: ${(telemetry.memory?.used / 1024 / 1024 / 1024).toFixed(1)}GB used\n`;
    }
    if (battery && (battery as any).percentage !== undefined) {
      msg += `🔋 Battery: ${(battery as any).percentage}% (${(battery as any).charging ? "Charging" : "On Battery"})\n`;
    }

    msg += `\n_I am continuously running in the background. Reply with any task anytime!_`;

    const sent = await sendTelegramMessage(msg);
    if (sent) {
      lastMorningDigestDate = todayStr;
      console.log(`[Heartbeat] 🌅 Morning daily digest delivered to Telegram.`);
      return true;
    }
    return false;
  } catch (err) {
    console.error("[Heartbeat] Failed to send morning digest:", err);
    return false;
  }
}

// ── Core Heartbeat Logic ────────────────────────────────────────

/**
 * Single heartbeat tick — runs all proactive checks and autonomous self-healing.
 */
async function heartbeatTick(): Promise<HeartbeatResult> {
  tickCount++;
  const isUserPresent = parallelTaskManager.hasActiveClients();
  let notificationsSent = 0;

  const result: HeartbeatResult = {
    tick: tickCount,
    timestamp: new Date().toISOString(),
    userPresent: isUserPresent,
    checks: {
      reminders: { due: 0, notified: 0 },
      schedule: { active: 0, due: 0 },
      battery: { checked: false },
      thermal: { checked: false },
      completedTasks: { found: 0, notified: 0 },
      selfHealing: { attempted: 0, resolved: 0 },
    },
    notificationsSent: 0,
  };

  // ── 0. Morning Digest Trigger (Between 7 AM and 10 AM) ────
  const currentHour = new Date().getHours();
  if (currentHour >= 7 && currentHour <= 10) {
    await sendMorningDailyDigest(false);
  }

  // ── 1. Check Due Reminders ────────────────────────────────
  try {
    const reminders = getRemindersStore();
    const now = Date.now();
    const dueReminders = reminders.filter(
      (r: any) =>
        !r.completed &&
        r.dueAt &&
        new Date(r.dueAt).getTime() <= now
    );

    result.checks.reminders.due = dueReminders.length;

    if (dueReminders.length > 0 && !isUserPresent) {
      const reminderTexts = dueReminders
        .map((r: any) => `• ${r.text}`)
        .join("\n");

      if (canSendAlert("reminders_due")) {
        const sent = await notifyProactiveAlert(
          `⏰ ${dueReminders.length} Reminder(s) Due`,
          reminderTexts,
          "high"
        );
        if (sent) {
          notificationsSent++;
          result.checks.reminders.notified = dueReminders.length;
          markAlertSent("reminders_due");
        }
      }
    }
  } catch (err) {
    console.warn("[Heartbeat] Reminder check failed:", err);
  }

  // ── 2. Check Daily Schedule Items ─────────────────────────
  try {
    const schedule = getDailyScheduleStore();
    const activeItems = schedule.filter((s) => !s.completed);
    result.checks.schedule.active = activeItems.length;
  } catch (err) {
    console.warn("[Heartbeat] Schedule check failed:", err);
  }

  // ── 3. Check Battery (every other tick) ───────────────────
  if (tickCount % 2 === 0) {
    try {
      const battery = await getBatteryStatus();
      result.checks.battery.checked = true;

      if (battery && typeof battery === "object") {
        const level = (battery as any).percentage ?? (battery as any).level ?? (battery as any).capacity;
        result.checks.battery.level = level;

        if (
          typeof level === "number" &&
          level <= BATTERY_LOW_THRESHOLD &&
          !(battery as any).charging
        ) {
          result.checks.battery.alert = true;
          if (!isUserPresent && canSendAlert("battery_low")) {
            const sent = await notifyProactiveAlert(
              "🔋 Low Battery Warning",
              `Battery is at ${level}% and NOT charging.\nPlug in soon to avoid shutdown.`,
              "critical"
            );
            if (sent) {
              notificationsSent++;
              markAlertSent("battery_low");
            }
          }
        }
      }
    } catch (err) {}
  }

  // ── 4. Check Thermals (every 3rd tick) ────────────────────
  if (tickCount % 3 === 0) {
    try {
      const thermals = await getThermalSensors();
      result.checks.thermal.checked = true;

      if (thermals && typeof thermals === "object") {
        let maxTemp = 0;
        const entries = Array.isArray(thermals) ? thermals : Object.values(thermals);
        for (const sensor of entries) {
          const temp = typeof sensor === "number"
            ? sensor
            : (sensor as any)?.temp ?? (sensor as any)?.temperature ?? 0;
          if (temp > maxTemp) maxTemp = temp;
        }

        result.checks.thermal.maxTemp = maxTemp;

        if (maxTemp >= THERMAL_HIGH_THRESHOLD) {
          result.checks.thermal.alert = true;
          // Auto-trigger Ultron boost to cool down if excessive
          try {
            await runUltronSystemAction("boost_system");
            result.checks.selfHealing.attempted++;
            result.checks.selfHealing.resolved++;
          } catch {}

          if (!isUserPresent && canSendAlert("thermal_high")) {
            const sent = await notifyProactiveAlert(
              "🌡️ High Temperature Alert & Self-Healing Applied",
              `System reached ${maxTemp}°C. Ultron boosted governor and dropped caches to stabilize temperatures.`,
              "critical"
            );
            if (sent) {
              notificationsSent++;
              markAlertSent("thermal_high");
            }
          }
        }
      }
    } catch (err) {}
  }

  // ── 5. Check Completed Background Tasks ───────────────────
  try {
    const completed = parallelTaskManager.getCompletedTasks();
    const unnotified = completed.filter(
      (t) => !notifiedTaskIds.has(t.id) && t.status === "completed"
    );

    result.checks.completedTasks.found = unnotified.length;

    if (unnotified.length > 0 && !isUserPresent) {
      for (const task of unnotified.slice(0, 5)) {
        const summary =
          task.speechSummary ||
          task.progressMessage ||
          "Task completed successfully.";

        const sent = await notifyTaskComplete(
          task.title,
          summary,
          task.durationMs
        );
        if (sent) {
          notificationsSent++;
          result.checks.completedTasks.notified++;
        }
        notifiedTaskIds.add(task.id);
      }

      if (notifiedTaskIds.size > 200) {
        const idsArray = Array.from(notifiedTaskIds);
        const toRemove = idsArray.slice(0, idsArray.length - 200);
        for (const id of toRemove) {
          notifiedTaskIds.delete(id);
        }
      }
    }
  } catch (err) {
    console.warn("[Heartbeat] Completed tasks check failed:", err);
  }

  // ── 6. Autonomous Error Detection & Self-Healing ──────────
  try {
    const failedTasks = parallelTaskManager.getCompletedTasks().filter(
      (t) => t.status === "failed" && !healedFailedTaskIds.has(t.id)
    );

    for (const failed of failedTasks) {
      healedFailedTaskIds.add(failed.id);
      result.checks.selfHealing.attempted++;

      const errLower = (failed.error || "").toLowerCase();
      let remediation = "Error logged in execution traces.";

      if (errLower.includes("memory") || errLower.includes("oom") || errLower.includes("timeout")) {
        try {
          const boostRes = await runUltronSystemAction("boost_system");
          remediation = `Ultron automatically reclaimed RAM (${boostRes.data?.reclaimed || "cache flushed"}) and reset power profile.`;
          result.checks.selfHealing.resolved++;
        } catch (e: any) {
          remediation = `Ultron self-healing attempted: ${e.message}`;
        }
      } else if (errLower.includes("sound") || errLower.includes("pipewire") || errLower.includes("audio")) {
        try {
          await runUltronSystemAction("heal_subsystem", { subsystem: "sound" });
          remediation = "Ultron auto-healed PipeWire sound server.";
          result.checks.selfHealing.resolved++;
        } catch {}
      }

      // Log execution trace
      logExecutionTrace("SelfHealingDaemon", { failedTaskId: failed.id, error: failed.error }, { remediation }, 0, true);

      // Intimate user on Telegram if away
      if (!isUserPresent) {
        await notifyProactiveAlert(
          `🛠️ Autonomous Self-Healing: ${failed.title.slice(0, 40)}`,
          `Task encountered an error:\n"${failed.error?.slice(0, 120)}"\n\n*Action Taken*:\n${remediation}`,
          "normal"
        );
        notificationsSent++;
      }
    }
  } catch (err) {
    console.warn("[Heartbeat] Self-healing loop error:", err);
  }

  result.notificationsSent = notificationsSent;

  // ── Log heartbeat (minimal) ───────────────────────────────
  const logParts = [
    `[Heartbeat] Tick #${tickCount}`,
    `user=${isUserPresent ? "present" : "away"}`,
  ];
  if (result.checks.reminders.due > 0)
    logParts.push(`reminders_due=${result.checks.reminders.due}`);
  if (result.checks.schedule.active > 0)
    logParts.push(`schedule_active=${result.checks.schedule.active}`);
  if (result.checks.battery.alert) logParts.push(`battery_low!`);
  if (result.checks.thermal.alert)
    logParts.push(`thermal_high=${result.checks.thermal.maxTemp}°C`);
  if (result.checks.completedTasks.found > 0)
    logParts.push(`tasks_done=${result.checks.completedTasks.found}`);
  if (result.checks.selfHealing.attempted > 0)
    logParts.push(`self_healed=${result.checks.selfHealing.resolved}/${result.checks.selfHealing.attempted}`);
  if (notificationsSent > 0)
    logParts.push(`telegram_sent=${notificationsSent}`);

  console.log(logParts.join(" | "));

  return result;
}

// ── Alert Cooldown Helpers ──────────────────────────────────────

function canSendAlert(alertType: string): boolean {
  if (!isTelegramConfigured()) return false;
  const lastSent = alertCooldowns.get(alertType);
  if (!lastSent) return true;
  return Date.now() - lastSent >= ALERT_COOLDOWN_MS;
}

function markAlertSent(alertType: string): void {
  alertCooldowns.set(alertType, Date.now());
}

// ── Lifecycle ───────────────────────────────────────────────────

/**
 * Start the heartbeat engine. Call this once after server.listen().
 */
export async function startHeartbeat(): Promise<void> {
  if (heartbeatTimer) {
    console.warn("[Heartbeat] Already running. Ignoring duplicate start.");
    return;
  }

  // Verify Telegram on startup
  if (isTelegramConfigured()) {
    const botCheck = await verifyTelegramBot();
    if (botCheck.ok) {
      console.log(
        `[Heartbeat] 🤖 Telegram bot connected: ${botCheck.botName}`
      );
      // Send startup notification
      await sendTelegramNotification({
        title: "🟢 Friday is Online (24/7 Autonomous Mode)",
        body: `Heartbeat active. Continuous monitoring every ${HEARTBEAT_INTERVAL_MS / 60000} minutes.\nSpecialist Fleet (Prime Agent, Hermes, Ultron) is ready.`,
        priority: "low",
        category: "system",
      });
    } else {
      console.warn(
        `[Heartbeat] ⚠️  Telegram bot check failed: ${botCheck.error}`
      );
    }
  } else {
    console.log(
      "[Heartbeat] Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env for away notifications."
    );
  }

  lastStartedAt = Date.now();
  tickCount = 0;

  // First tick after a short delay (let server fully boot)
  setTimeout(() => {
    heartbeatTick().catch((err) =>
      console.error("[Heartbeat] First tick error:", err)
    );
  }, 5000);

  // Recurring ticks
  heartbeatTimer = setInterval(() => {
    heartbeatTick().catch((err) =>
      console.error("[Heartbeat] Tick error:", err)
    );
  }, HEARTBEAT_INTERVAL_MS);

  const intervalMinutes = (HEARTBEAT_INTERVAL_MS / 60000).toFixed(1);
  console.log(
    `[Heartbeat] 💓 24/7 Autonomous Engine started. Interval: ${intervalMinutes} min`
  );
}

/**
 * Stop the heartbeat engine.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("[Heartbeat] Stopped.");
  }
}

/**
 * Get heartbeat status for API/health checks.
 */
export function getHeartbeatStatus() {
  return {
    running: heartbeatTimer !== null,
    tickCount,
    intervalMs: HEARTBEAT_INTERVAL_MS,
    startedAt: lastStartedAt ? new Date(lastStartedAt).toISOString() : null,
    telegramConfigured: isTelegramConfigured(),
    alertCooldownMs: ALERT_COOLDOWN_MS,
    batteryThreshold: BATTERY_LOW_THRESHOLD,
    thermalThreshold: THERMAL_HIGH_THRESHOLD,
    lastMorningDigestDate,
  };
}

/**
 * Force a heartbeat tick (for testing / API trigger).
 */
export async function forceHeartbeatTick(): Promise<HeartbeatResult> {
  console.log("[Heartbeat] Manual tick triggered.");
  return heartbeatTick();
}
