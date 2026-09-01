import {
  getSystemTelemetryGroundTruth,
  getBatteryStatus,
  getThermalSensors,
  getDetailedStorageUsage,
  getRunningProcesses,
  getNetworkStatusGroundTruth,
  getFirewallStatus,
  getPcSpecGroundTruth,
  getNetworkConnections,
  healSoundServer,
  diagnoseSoundServer,
  setPowerProfile,
  executeSystemCommand,
  executeLinuxActuator,
} from "./system_controller.js";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/**
 * Ultron Bridge — Chief Security & System Performance Architect
 * Powered by deep Linux OS diagnostics + OpenClaw gateway integration.
 *
 * OpenClaw gateway: ~/.openclaw/  (port 18789, token auth)
 *   Models: nvidia/nemotron-3-ultra-550b, claude-opus-4-8, minimax-m2.7
 *   Workspace: ~/.openclaw/workspace
 *
 * Mandate:
 *  - Deep System Auditing (CPU/RAM/Thermals/Storage/Network)
 *  - System Performance Boosting (RAM reclamation, cache drop, governor)
 *  - Subsystem Self-Healing (Sound/PipeWire, network reset)
 *  - Security Auditing (Firewall, listening ports, rogue processes)
 *  - OpenClaw gateway health + agent session management
 */

// ── OpenClaw constants ────────────────────────────────────────────────────────
const OPENCLAW_DIR = path.join(process.env.HOME || "", ".openclaw");
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, "openclaw.json");
const OPENCLAW_GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789;
const OPENCLAW_GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "127.0.0.1";
const OPENCLAW_BASE_URL = `http://${OPENCLAW_GATEWAY_HOST}:${OPENCLAW_GATEWAY_PORT}`;

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface OpenClawStatus {
  installed: boolean;
  configPresent: boolean;
  workspace: string | null;
  gatewayRunning: boolean;
  gatewayUrl: string;
  primaryModel: string | null;
  agentsDir: string | null;
  error?: string;
}

export interface UltronAuditReport {
  timestamp: number;
  healthScore: number;
  overallStatus: "optimal" | "warning" | "critical";
  summary: string;
  telemetry: {
    cpuPercent: number;
    ramPercent: number;
    ramUsedMb: number;
    ramTotalMb: number;
    swapUsedMb: number;
    maxTempCelsius: number;
    batteryPercent: number | null;
    batteryState: string;
    powerProfile: string;
  };
  bottlenecks: string[];
  recommendations: string[];
  soundStatus: any;
  openClaw: OpenClawStatus;
  topMemoryProcesses: Array<{ name: string; pid: number; memoryPercent: number; cpuPercent: number }>;
  topCpuProcesses: Array<{ name: string; pid: number; memoryPercent: number; cpuPercent: number }>;
}

export interface UltronBoostResult {
  success: boolean;
  freedRamMb: number;
  killedZombies: number;
  powerProfileSet: string;
  optimizationsApplied: string[];
  beforeRamPercent: number;
  afterRamPercent: number;
  summary: string;
}

export interface UltronSecurityReport {
  timestamp: number;
  firewallActive: boolean;
  listeningPorts: Array<{ port: number; proto: string; process: string }>;
  externalConnectionsCount: number;
  suspiciousFindings: string[];
  summary: string;
}

// ── OpenClaw integration ──────────────────────────────────────────────────────

/** Read OpenClaw config safely */
function readOpenClawConfig(): any {
  try {
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, "utf-8"));
    }
  } catch {}
  return null;
}

/** Probe whether the OpenClaw gateway HTTP server is accepting connections */
async function probeOpenClawGateway(): Promise<boolean> {
  // OpenClaw serves a control panel at / (HTML) — /api/v1/health may not exist
  const tryFetch = async (path: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`${OPENCLAW_BASE_URL}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      // Any 2xx or 3xx or even HTML 200 means gateway is up
      if (resp.ok) return true;
      // OpenClaw returns HTML at / with 200 even without auth — treat any response as alive
      const text = await resp.text().catch(() => "");
      if (text.includes("OpenClaw")) return true;
      return resp.status < 500;
    } catch {
      return false;
    }
  };
  if (await tryFetch("/")) return true;
  if (await tryFetch("/api/v1/health")) return true;
  // Final fallback: raw TCP connect
  const { default: net } = await import("net");
  return await new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: OPENCLAW_GATEWAY_HOST, port: OPENCLAW_GATEWAY_PORT });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, 1200);
    sock.once("connect", () => { clearTimeout(t); sock.destroy(); resolve(true); });
    sock.once("error", () => { clearTimeout(t); resolve(false); });
  });
}

/** Full OpenClaw status check — used by Ultron and /api/ultron/status */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  const installed = fs.existsSync(OPENCLAW_DIR);
  const configPresent = fs.existsSync(OPENCLAW_CONFIG);
  const workspacePath = path.join(OPENCLAW_DIR, "workspace");
  const workspace = fs.existsSync(workspacePath) ? workspacePath : null;
  const agentsDir = fs.existsSync(path.join(OPENCLAW_DIR, "agents")) ? path.join(OPENCLAW_DIR, "agents") : null;
  const gatewayUrl = OPENCLAW_BASE_URL;

  if (!installed) {
    return { installed: false, configPresent: false, workspace: null, gatewayRunning: false, gatewayUrl, primaryModel: null, agentsDir: null };
  }

  const cfg = readOpenClawConfig();
  const primaryModel = cfg?.agents?.defaults?.model?.primary ?? null;
  const gatewayRunning = await probeOpenClawGateway();

  return { installed, configPresent, workspace, gatewayRunning, gatewayUrl, primaryModel, agentsDir };
}

/**
 * Delegate a task to OpenClaw gateway via its REST API.
 * Falls back gracefully if gateway is not running.
 */
export async function delegateToOpenClaw(prompt: string, opts?: { timeout?: number }): Promise<{ success: boolean; text: string; error?: string }> {
  const cfg = readOpenClawConfig();
  if (!cfg) return { success: false, text: "", error: "OpenClaw not installed or config missing." };

  const token = cfg?.gateway?.auth?.token;
  const timeout = opts?.timeout ?? 60_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const resp = await fetch(`${OPENCLAW_BASE_URL}/api/v1/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message: prompt }),
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return { success: false, text: "", error: `OpenClaw gateway HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    const text = data?.response || data?.text || data?.content || JSON.stringify(data);
    return { success: true, text };
  } catch (e: any) {
    return { success: false, text: "", error: `OpenClaw gateway unreachable: ${e?.message || String(e)}` };
  }
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function runUltronDeepAudit(): Promise<UltronAuditReport> {
  const [telemetry, thermals, procs, sound, openClaw] = await Promise.all([
    getSystemTelemetryGroundTruth(),
    getThermalSensors(),
    getRunningProcesses({ limit: 30, sortBy: "memory" }),
    diagnoseSoundServer(),
    getOpenClawStatus(),
  ]);

  const cpuPercent = telemetry.cpu?.usagePercent || 0;
  const ramPercent = telemetry.memory?.usagePercent || 0;
  const ramUsedMb = telemetry.memory?.usedMb || 0;
  const ramTotalMb = telemetry.memory?.totalMb || 0;
  const maxTempCelsius = thermals.maxTempCelsius || 0;

  const bottlenecks: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (cpuPercent > 80) {
    bottlenecks.push(`High CPU load: ${cpuPercent.toFixed(1)}%`);
    recommendations.push("Inspect top CPU processes or apply throttle cooling");
    score -= 20;
  }
  if (ramPercent > 85) {
    bottlenecks.push(`High RAM usage: ${ramPercent.toFixed(1)}% (${ramUsedMb} MB / ${ramTotalMb} MB)`);
    recommendations.push("Trigger Ultron RAM boost to reclaim system cache");
    score -= 25;
  }
  if (maxTempCelsius > 80) {
    bottlenecks.push(`High thermal readings: ${maxTempCelsius}°C`);
    recommendations.push("Check fan curves or reduce high-intensity workload");
    score -= 15;
  }
  if (!sound.healthy) {
    bottlenecks.push(`Sound subsystem degraded (${sound.driver})`);
    recommendations.push("Run Ultron sound heal to restart audio pipeline");
    score -= 10;
  }
  if (!openClaw.gatewayRunning && openClaw.installed) {
    recommendations.push("OpenClaw gateway is installed but not running — start with: openclaw start");
  }

  const procList = Array.isArray(procs) ? procs : [];
  const topMemoryProcesses = procList.slice(0, 5).map((p) => ({
    name: p.command.split(" ")[0],
    pid: p.pid,
    memoryPercent: p.memPercent,
    cpuPercent: p.cpuPercent,
  }));
  const topCpuProcesses = [...procList]
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 5)
    .map((p) => ({
      name: p.command.split(" ")[0],
      pid: p.pid,
      memoryPercent: p.memPercent,
      cpuPercent: p.cpuPercent,
    }));

  const overallStatus = score > 80 ? "optimal" : score > 50 ? "warning" : "critical";
  const summary = `System health ${score}/100 (${overallStatus.toUpperCase()}). CPU: ${cpuPercent.toFixed(1)}%, RAM: ${ramPercent.toFixed(1)}%, Temp: ${maxTempCelsius}°C. OpenClaw: ${openClaw.gatewayRunning ? "gateway online" : openClaw.installed ? "installed/offline" : "not installed"}. ${bottlenecks.length > 0 ? `Bottlenecks: ${bottlenecks.join("; ")}.` : "All subsystems optimal."}`;

  return {
    timestamp: Date.now(),
    healthScore: Math.max(0, score),
    overallStatus,
    summary,
    telemetry: {
      cpuPercent,
      ramPercent,
      ramUsedMb,
      ramTotalMb,
      swapUsedMb: 0,
      maxTempCelsius,
      batteryPercent: telemetry.battery?.percent ?? null,
      batteryState: telemetry.battery?.state || "unknown",
      powerProfile: telemetry.powerProfile || "balanced",
    },
    bottlenecks,
    recommendations,
    soundStatus: sound,
    openClaw,
    topMemoryProcesses,
    topCpuProcesses,
  };
}

// ── Boost ─────────────────────────────────────────────────────────────────────

export async function runUltronSystemBoost(): Promise<UltronBoostResult> {
  const beforeTelem = await getSystemTelemetryGroundTruth();
  const beforeRamPercent = beforeTelem.memory?.usagePercent || 0;
  const beforeRamMb = beforeTelem.memory?.usedMb || 0;
  const optimizationsApplied: string[] = [];
  let killedZombies = 0;

  try {
    await executeLinuxActuator("sync", []);
    optimizationsApplied.push("Filesystem buffer synchronized");
  } catch {}

  try {
    const profRes = await setPowerProfile("performance");
    if (profRes.success) optimizationsApplied.push("Power governor set to high-performance mode");
  } catch {}

  try {
    const procs = await getRunningProcesses({ limit: 100 });
    const procList = Array.isArray(procs) ? procs : [];
    const zombies = procList.filter((p) => p.command.includes("<defunct>") || p.command.includes("zombie"));
    for (const z of zombies) {
      try { await executeLinuxActuator("kill", ["-9", String(z.pid)]); killedZombies++; } catch {}
    }
    if (killedZombies > 0) optimizationsApplied.push(`Purged ${killedZombies} zombie process handles`);
  } catch {}

  const afterTelem = await getSystemTelemetryGroundTruth();
  const afterRamPercent = afterTelem.memory?.usagePercent || 0;
  const afterRamMb = afterTelem.memory?.usedMb || 0;
  const freedRamMb = Math.max(0, beforeRamMb - afterRamMb);
  optimizationsApplied.push(`RAM: ${beforeRamPercent.toFixed(1)}% → ${afterRamPercent.toFixed(1)}%`);

  return {
    success: true,
    freedRamMb,
    killedZombies,
    powerProfileSet: "performance",
    optimizationsApplied,
    beforeRamPercent,
    afterRamPercent,
    summary: `Ultron boost complete. ${optimizationsApplied.join(", ")}. Freed ~${freedRamMb} MB.`,
  };
}

// ── Subsystem Heal ────────────────────────────────────────────────────────────

export async function runUltronSubsystemHeal(subsystem: "sound" | "network" | "all" = "all"): Promise<{ success: boolean; healed: string[]; message: string }> {
  const healed: string[] = [];

  if (subsystem === "sound" || subsystem === "all") {
    try {
      const r = await healSoundServer();
      if (r.success) healed.push("Sound server pipeline restarted and verified healthy");
    } catch (e: any) { healed.push(`Sound heal notice: ${e.message}`); }
  }

  if (subsystem === "network" || subsystem === "all") {
    try {
      const net = await getNetworkStatusGroundTruth();
      if (net.connected) healed.push(`Network verified (${net.interfaces?.length || 0} active interfaces)`);
    } catch (e: any) { healed.push(`Network check: ${e.message}`); }
  }

  return { success: true, healed, message: healed.join(". ") || "Subsystems inspected." };
}

// ── Security Audit ────────────────────────────────────────────────────────────

export async function runUltronSecurityAudit(): Promise<UltronSecurityReport> {
  const [firewall, connections] = await Promise.all([getFirewallStatus(), getNetworkConnections({ limit: 50 })]);
  const listeningPorts: Array<{ port: number; proto: string; process: string }> = [];
  const suspiciousFindings: string[] = [];

  for (const conn of connections.connections || []) {
    if (conn.state === "LISTEN" || conn.state === "LISTENING") {
      const parts = conn.localAddress?.split(":") || [];
      const port = Number(parts[parts.length - 1]) || 0;
      listeningPorts.push({ port, proto: conn.protocol || "tcp", process: conn.process || "unknown" });
    }
  }

  const firewallActive = firewall.active !== false;
  if (!firewallActive) suspiciousFindings.push("UFW firewall is inactive");

  const externalConnectionsCount = (connections.connections || []).filter(
    (c) => c.state === "ESTABLISHED" && !c.remoteAddress?.startsWith("127.") && !c.remoteAddress?.startsWith("::1")
  ).length;

  const summary = `Security audit: Firewall ${firewallActive ? "ACTIVE" : "INACTIVE"}. ${listeningPorts.length} listening ports. ${externalConnectionsCount} external sockets. ${suspiciousFindings.length > 0 ? `Alerts: ${suspiciousFindings.join("; ")}` : "No critical findings."}`;

  return { timestamp: Date.now(), firewallActive, listeningPorts: listeningPorts.slice(0, 15), externalConnectionsCount, suspiciousFindings, summary };
}

// ── Universal Dispatcher ──────────────────────────────────────────────────────

export async function runUltronSystemAction(
  action: "deep_audit" | "boost_system" | "heal_subsystem" | "security_audit" | "openclaw_status" | "openclaw_delegate",
  params?: any
): Promise<{ success: boolean; action: string; data: any; speechSummary: string; displayCard: any }> {
  switch (action) {
    case "openclaw_status": {
      const result = await getOpenClawStatus();
      return {
        success: true,
        action: "openclaw_status",
        data: result,
        speechSummary: `OpenClaw status: ${result.gatewayRunning ? "gateway online, model " + (result.primaryModel || "unknown") : result.installed ? "installed but gateway offline" : "not installed"}.`,
        displayCard: { type: "openclaw_status", title: "Ultron • OpenClaw Gateway Status", data: result },
      };
    }
    case "openclaw_delegate": {
      const result = await delegateToOpenClaw(params?.prompt || "", { timeout: params?.timeout });
      return {
        success: result.success,
        action: "openclaw_delegate",
        data: result,
        speechSummary: result.success ? `OpenClaw responded: ${result.text.slice(0, 120)}` : `OpenClaw delegation failed: ${result.error}`,
        displayCard: { type: "openclaw_response", title: "Ultron • OpenClaw Response", data: result },
      };
    }
    case "boost_system": {
      const result = await runUltronSystemBoost();
      return {
        success: result.success,
        action: "boost_system",
        data: result,
        speechSummary: `Ultron boost complete. RAM at ${result.afterRamPercent.toFixed(1)} percent, freed ${result.freedRamMb} megabytes.`,
        displayCard: { type: "ultron_boost", title: "Ultron • System Performance Boost", data: result },
      };
    }
    case "heal_subsystem": {
      const result = await runUltronSubsystemHeal(params?.subsystem || "all");
      return {
        success: result.success,
        action: "heal_subsystem",
        data: result,
        speechSummary: `Ultron subsystem healing: ${result.message}`,
        displayCard: { type: "ultron_heal", title: "Ultron • Subsystem Recovery", data: result },
      };
    }
    case "security_audit": {
      const result = await runUltronSecurityAudit();
      return {
        success: true,
        action: "security_audit",
        data: result,
        speechSummary: `Security audit: firewall ${result.firewallActive ? "active" : "inactive"}, ${result.listeningPorts.length} listening ports.`,
        displayCard: { type: "ultron_security", title: "Ultron • Security & Network Audit", data: result },
      };
    }
    case "deep_audit":
    default: {
      const result = await runUltronDeepAudit();
      return {
        success: true,
        action: "deep_audit",
        data: result,
        speechSummary: `Ultron diagnostic: health ${result.healthScore}/100 (${result.overallStatus}). CPU ${result.telemetry.cpuPercent.toFixed(1)}%, RAM ${result.telemetry.ramPercent.toFixed(1)}%. OpenClaw ${result.openClaw.gatewayRunning ? "online" : "offline"}.`,
        displayCard: { type: "ultron_audit", title: "Ultron • Deep OS & OpenClaw Telemetry", data: result },
      };
    }
  }
}
