import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

const HERMES_BIN = process.env.HERMES_BIN || "hermes";
const TIMEOUT_MS = 120_000;

export interface HermesResult {
  success: boolean;
  text: string;
  raw?: string;
  error?: string;
}

function getHermesCommand(): string {
  // On Windows, Hermes is installed via the shim; use hermes directly
  // In packaged Electron, PATH may not include shim — try absolute fallback
  return process.env.HERMES_BIN || "hermes";
}

/**
 * Execute Hermes headless query. Uses --query-file to avoid shell escaping issues.
 * Safe for arbitrary text including quotes, backticks, $(...).
 */
export async function execHermes(prompt: string, opts?: { timeout?: number }): Promise<HermesResult> {
  const timeout = opts?.timeout ?? TIMEOUT_MS;
  const tmpFile = path.join(process.cwd(), `.hermes_query_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`);
  try {
    fs.writeFileSync(tmpFile, prompt, "utf-8");
    const bin = getHermesCommand();
    // Use --query-file + --oneshot for safe, non-interactive execution
    const cmd = `${bin} chat --oneshot --query-file "${tmpFile}"`;
    const { stdout, stderr } = await execAsync(cmd, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env },
    });
    const text = (stdout || stderr || "").trim();
    if (!text) {
      return { success: false, text: "", error: "Empty response from Hermes" };
    }
    return { success: true, text, raw: text };
  } catch (e: any) {
    const msg = e?.stderr || e?.stdout || e?.message || String(e);
    // Clean up hermes error prefixes
    const clean = msg.slice(0, 2000).trim();
    return { success: false, text: "", error: clean };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

export async function checkHermesHealth(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const bin = getHermesCommand();
    const { stdout } = await execAsync(`${bin} --help`, { timeout: 8000, windowsHide: true });
    const firstLine = stdout.split("\n")[0]?.slice(0, 120) || "hermes";
    const ok = stdout.includes("hermes") || stdout.includes("usage:") || stdout.includes("Hermes");
    return { ok, version: firstLine };
  } catch (e: any) {
    return { ok: false, error: (e?.message || String(e)).slice(0, 500) };
  }
}

// Vault path resolver — shared with obsidian skills
export function getVaultPath(): string {
  return (
    process.env.OBSIDIAN_VAULT_PATH ||
    process.env.VAULT_PATH ||
    path.join(process.cwd(), "jarvis-memory")
  );
}
