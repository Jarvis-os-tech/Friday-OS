import fs from "fs";
import path from "path";
import net from "net";
import { execFileSync } from "child_process";

/**
 * OpenClaw Bridge — Autonomous Agent Gateway & Workspace Specialist
 *
 * Connects Friday-OS directly to the OpenClaw Gateway running locally on port 18789.
 *
 * Config & State:
 *   - ~/.openclaw/openclaw.json (gateway auth token, primary model, ports)
 *   - ~/.openclaw/workspace (sandboxed project tools & files)
 *   - ~/.openclaw/agents (agent configurations & session history)
 */

const OPENCLAW_DIR = path.join(process.env.HOME || "", ".openclaw");
const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, "openclaw.json");
const OPENCLAW_GATEWAY_PORT = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789;
const OPENCLAW_GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || "127.0.0.1";
const OPENCLAW_BASE_URL = `http://${OPENCLAW_GATEWAY_HOST}:${OPENCLAW_GATEWAY_PORT}`;

export interface OpenClawHealth {
  ok: boolean;
  installed: boolean;
  configPresent: boolean;
  gatewayRunning: boolean;
  gatewayUrl: string;
  primaryModel: string | null;
  workspace: string | null;
  agentsDir: string | null;
  error?: string;
}

export interface OpenClawResult {
  success: boolean;
  text: string;
  model?: string;
  sessionId?: string;
  raw?: any;
  error?: string;
}

/** Read OpenClaw config safely */
export function readOpenClawConfig(): any {
  try {
    if (fs.existsSync(OPENCLAW_CONFIG)) {
      return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, "utf-8"));
    }
  } catch {}
  return null;
}

/** Probe whether the OpenClaw gateway HTTP server or port is accepting connections */
export async function probeOpenClawGateway(): Promise<boolean> {
  const tryFetch = async (endpoint: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`${OPENCLAW_BASE_URL}${endpoint}`, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) return true;
      const text = await resp.text().catch(() => "");
      if (text.includes("OpenClaw")) return true;
      return resp.status < 500;
    } catch {
      return false;
    }
  };

  if (await tryFetch("/")) return true;
  if (await tryFetch("/api/v1/health")) return true;

  // Fallback: TCP socket connect
  return await new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: OPENCLAW_GATEWAY_HOST, port: OPENCLAW_GATEWAY_PORT });
    const t = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1200);
    sock.once("connect", () => {
      clearTimeout(t);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/** Full OpenClaw health check — consumes gateway and local filesystem */
export async function checkOpenClawHealth(): Promise<OpenClawHealth> {
  const installed = fs.existsSync(OPENCLAW_DIR);
  const configPresent = fs.existsSync(OPENCLAW_CONFIG);
  const workspacePath = path.join(OPENCLAW_DIR, "workspace");
  const workspace = fs.existsSync(workspacePath) ? workspacePath : null;
  const agentsDir = fs.existsSync(path.join(OPENCLAW_DIR, "agents"))
    ? path.join(OPENCLAW_DIR, "agents")
    : null;
  const gatewayUrl = OPENCLAW_BASE_URL;

  if (!installed) {
    return {
      ok: false,
      installed: false,
      configPresent: false,
      workspace: null,
      gatewayRunning: false,
      gatewayUrl,
      primaryModel: null,
      agentsDir: null,
      error: "OpenClaw directory ~/.openclaw not found",
    };
  }

  const cfg = readOpenClawConfig();
  const primaryModel = cfg?.agents?.defaults?.model?.primary ?? "nvidia/nemotron-3-ultra-550b-a55b";
  const gatewayRunning = await probeOpenClawGateway();

  return {
    ok: installed && (gatewayRunning || configPresent),
    installed,
    configPresent,
    workspace,
    gatewayRunning,
    gatewayUrl,
    primaryModel,
    agentsDir,
  };
}

/**
 * Execute a delegated task against OpenClaw gateway.
 */
export async function execOpenClaw(
  prompt: string,
  opts?: { timeout?: number; model?: string }
): Promise<OpenClawResult> {
  const cfg = readOpenClawConfig();
  const token = cfg?.gateway?.auth?.token;
  const timeout = opts?.timeout ?? 60_000;
  const model = opts?.model || cfg?.agents?.defaults?.model?.primary || "nvidia/nemotron-3-ultra-550b-a55b";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(`${OPENCLAW_BASE_URL}/api/v1/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message: prompt, model }),
    });
    clearTimeout(timer);

    if (!resp.ok) {
      // If gateway returned an error status, provide detail
      const errText = await resp.text().catch(() => "");
      return {
        success: false,
        text: "",
        error: `OpenClaw gateway HTTP ${resp.status}: ${errText || "Request failed"}`,
      };
    }

    const data: any = await resp.json();
    const text = data?.response || data?.text || data?.content || (typeof data === "string" ? data : JSON.stringify(data));
    const sessionId = data?.sessionId || data?.session_id;

    return {
      success: true,
      text: typeof text === "string" ? text : JSON.stringify(text),
      model,
      sessionId,
      raw: data,
    };
  } catch (e: any) {
    return {
      success: false,
      text: "",
      error: `OpenClaw gateway unreachable at ${OPENCLAW_BASE_URL}: ${e?.message || String(e)}`,
    };
  }
}
