import { execFile, execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";

/**
 * Hermes Bridge — the connection layer that lets FRIDAY delegate work to Hermes.
 *
 * This version uses a single, default Hermes profile for all delegations.
 *
 * Two communication paths:
 *   1. CLI delegation (primary): `hermes chat --query-file` — spawns Hermes headless
 *      for a single delegated task and returns the final text response. Robust,
 *      always available, no extra services required.
 *   2. Live gateway (optional): a running `hermes serve` JSON-RPC/WebSocket gateway
 *      on 127.0.0.1:9119. When present we report it as "connected" so the UI can show
 *      Hermes as online. The CLI path still executes the actual work; the gateway is
 *      the liveness/status signal.
 */

const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS) || 180_000;
const MAX_TURNS = Number(process.env.HERMES_MAX_TURNS) || 12;
// Default gateway URL for the single Hermes profile
const GATEWAY_URL = process.env.HERMES_GATEWAY_URL || "127.0.0.1:9119";
const OMH_TOOLSET_WARN = /Warning:\s*Unknown toolsets:\s*omh/i;

export interface HermesResult {
  success: boolean;
  text: string;
  raw?: string;
  sessionId?: string;
  error?: string;
}

export interface HermesHealth {
  ok: boolean;
  version?: string;
  error?: string;
  gateway?: {
    url: string;
    reachable: boolean;
    error?: string;
  };
}

function getHermesBin(): string {
  return process.env.HERMES_BIN || "hermes";
}

/**
 * Strip Hermes CLI noise from stdout.
 *
 * `hermes chat -Q` can emit a leading "Warning: Unknown toolsets: omh" line plus a
 * trailing "session_id: ..." line. Neither is part of the real answer.
 */
function cleanHermesOutput(raw: string): { text: string; sessionId?: string } {
  const lines = raw.split(/\r?\n/);
  let sessionId: string | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    if (OMH_TOOLSET_WARN.test(line)) continue;
    if (line.includes("found but has no messages. Starting fresh")) continue;
    if (line.includes("Loaded cached tools")) continue;
    const sid = line.match(/^\s*session_id:\s*(\S+)/i);
    if (sid) {
      sessionId = sid[1];
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), sessionId };
}

/**
 * Execute a single delegated task against Hermes, headless and non-interactive.
 *
 * Uses --query-file (not -q) so arbitrary text — quotes, backticks, $(...) — is passed
 * verbatim and never shell-interpreted.
 */
export function execHermes(
  prompt: string,
  opts?: {
    timeout?: number;
    maxTurns?: number;
    yolo?: boolean;
    sessionName?: string;
  }
): Promise<HermesResult> {
  const timeout = opts?.timeout ?? TIMEOUT_MS;
  const maxTurns = opts?.maxTurns ?? MAX_TURNS;
  const yolo = opts?.yolo !== false; // default true for autonomous delegation
  const sessionName = opts?.sessionName || `friday-delegated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const bin = getHermesBin();

  return new Promise<HermesResult>((resolve) => {
    const tmpFile = path.join(
      process.cwd(),
      `.hermes_query_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`
    );
    let child: ChildProcess | undefined;
    let settled = false;

    const finish = (r: HermesResult) => {
      if (settled) return;
      settled = true;
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {}
      resolve(r);
    };

    const timer = setTimeout(() => {
      try {
        child?.kill("SIGKILL");
      } catch {}
      finish({
        success: false,
        text: "",
        error: `Hermes timed out after ${timeout}ms (task may have looped).`,
      });
    }, timeout);

    try {
      fs.writeFileSync(tmpFile, prompt, "utf-8");
      const args: string[] = [];
      // Always use the default profile
      args.push("-p", "default");
      args.push(
        "chat",
        "--continue",
        sessionName,
        "--create-if-missing",
        "--query-file",
        tmpFile,
        "-Q", // quiet: only the final response + session id
        "--max-turns",
        String(maxTurns)
      );
      if (yolo) args.push("--yolo"); // autonomous delegation: no approval prompts

      child = execFile(bin, args, {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        clearTimeout(timer);
        finish({
          success: false,
          text: "",
          error: `Failed to launch Hermes (${bin}): ${err.message}`,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const { text, sessionId } = cleanHermesOutput(stdout);
        if (code === 0 && text) {
          finish({ success: true, text, raw: stdout, sessionId });
        } else {
          const msg = (stderr || stdout || `exit code ${code}`).slice(0, 2000).trim();
          finish({
            success: false,
            text: "",
            raw: stdout,
            sessionId,
            error: msg || "Hermes returned an empty response.",
          });
        }
      });
    } catch (e: any) {
      clearTimeout(timer);
      finish({ success: false, text: "", error: (e?.message || String(e)).slice(0, 500) });
    }
  });
}

let cachedVersion: string | undefined;
let lastVersionCheck = 0;

/** Reachability probe for a running `hermes serve` or `hermes-gateway` service. */
async function probeGateway(url: string): Promise<{ reachable: boolean; error?: string }> {
  // Check systemd user service first
  try {
    const status = execFileSync("systemctl", ["--user", "is-active", "hermes-gateway.service"], {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    if (status === "active") {
      return { reachable: true };
    }
  } catch {
    // Fall back to socket probe
  }

  return new Promise((resolve) => {
    const [host, portStr] = url.split(":");
    const port = Number(portStr) || 9119;
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ reachable: false, error: "connection timed out" });
    }, 1500);
    sock.setTimeout(1500);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ reachable: true });
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      resolve({ reachable: false, error: err.message });
    });
  });
}

export async function checkHermesHealth(): Promise<HermesHealth> {
  // 1. Can we even find the binary?
  const now = Date.now();
  if (!cachedVersion || now - lastVersionCheck > 300_000) {
    try {
      const out = execFileSync(getHermesBin(), ["--version"], {
        windowsHide: true,
        timeout: 20_000,
        encoding: "utf-8",
      });
      cachedVersion = out.trim().split("\n")[0]?.slice(0, 120);
      lastVersionCheck = now;
    } catch (e: any) {
      // If version call failed or timed out, try falling back to simple binary check
      try {
        const whichOut = execFileSync("which", [getHermesBin()], { encoding: "utf-8", timeout: 2000 });
        if (whichOut.trim()) {
          cachedVersion = "Hermes Agent (verified CLI)";
          lastVersionCheck = now;
        }
      } catch {
        return {
          ok: false,
          error: `Hermes binary not found or not runnable: ${(e?.message || String(e)).slice(0, 300)}`,
          gateway: { url: GATEWAY_URL, reachable: false },
        };
      }
    }
  }

  // 2. Is the live gateway up? (non-fatal — CLI delegation still works without it)
  const gateway = await probeGateway(GATEWAY_URL);

  return {
    ok: true,
    version: cachedVersion,
    gateway: { url: GATEWAY_URL, reachable: gateway.reachable, error: gateway.error },
  };
}

/** Vault path resolver — shared with obsidian skills. */
export function getVaultPath(): string {
  // Always use the single friday-memory vault
  return path.join(process.cwd(), "friday-memory");
}
