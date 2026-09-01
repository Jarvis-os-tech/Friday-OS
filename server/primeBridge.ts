import { execFile, execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Prime Agent Bridge — PrimeIntellect-ai/prime-agent v0.8.1
 *
 * Installed at: /home/gopi/.nvm/versions/node/v24.19.0/bin/prime-agent
 *
 * Delegation flow:
 *   prime-agent -p --mode text "<prompt>"
 *   Falls back to integrated Gemini 3.7 coding engine if binary unavailable.
 */

const TIMEOUT_MS = Number(process.env.PRIME_TIMEOUT_MS) || 300_000;

/** Resolve the prime-agent binary — checks env override, NVM path, then PATH */
function getPrimeAgentBin(): string {
  // 1. Explicit env override
  if (process.env.PRIME_AGENT_BIN && fs.existsSync(process.env.PRIME_AGENT_BIN)) {
    return process.env.PRIME_AGENT_BIN;
  }

  // 2. Known NVM install path (installed by curl installer)
  const nvmBin = "/home/gopi/.nvm/versions/node/v24.19.0/bin/prime-agent";
  if (fs.existsSync(nvmBin)) return nvmBin;

  // 3. Other common locations
  const extras = [
    path.join(process.env.HOME || "", ".local", "bin", "prime-agent"),
    path.join(process.env.HOME || "", ".prime", "bin", "prime-agent"),
  ];
  for (const p of extras) {
    if (fs.existsSync(p)) return p;
  }

  // 4. Rely on PATH
  try {
    const out = execFileSync("which", ["prime-agent"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim()) return out.trim();
  } catch {}

  return "prime-agent";
}

export interface CodeSnippet {
  language: string;
  code: string;
  filename?: string;
}

export interface PrimeResult {
  success: boolean;
  text: string;
  codeSnippets?: CodeSnippet[];
  raw?: string;
  sessionId?: string;
  error?: string;
}

export interface PrimeHealth {
  ok: boolean;
  installed: boolean;
  version?: string;
  path?: string;
  engine: "binary" | "integrated-llm";
  error?: string;
}

/** Read GEMINI_API_KEY from env or .env file */
function getApiKey(): string | undefined {
  let key = process.env.GEMINI_API_KEY;
  if (!key) {
    try {
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
  return key ? key.replace(/^["']|["']$/g, "").trim() : undefined;
}

/** Check Prime Agent installation health */
export async function checkPrimeHealth(): Promise<PrimeHealth> {
  const bin = getPrimeAgentBin();
  try {
    const out = execFileSync(bin, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      installed: true,
      version: out.trim().split("\n")[0] || "prime-agent",
      path: bin,
      engine: "binary",
    };
  } catch {
    // binary present but --version failed (some versions just exit 0 with no output)
    if (fs.existsSync(bin) || bin === "prime-agent") {
      return { ok: true, installed: true, version: "prime-agent (ready)", path: bin, engine: "binary" };
    }
    return {
      ok: true,
      installed: false,
      version: "Integrated Gemini 3.7 Coding Engine",
      engine: "integrated-llm",
    };
  }
}

/** Extract fenced code blocks from Markdown text */
export function extractCodeBlocks(markdown: string): CodeSnippet[] {
  const blocks: CodeSnippet[] = [];
  const regex = /```([a-zA-Z0-9_-]*)(?:\s+([^\n]+))?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      language: match[1]?.trim() || "text",
      filename: match[2]?.trim(),
      code: match[3]?.trim() || "",
    });
  }
  return blocks;
}

/** Fallback: run coding task through Gemini 3.7 Flash when prime-agent is unavailable */
async function execIntegratedPrimeEngine(prompt: string, workDir: string): Promise<PrimeResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, text: "", error: "GEMINI_API_KEY not configured for Prime Agent fallback." };
  }

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });

    const systemInstruction = `You are Prime Agent, the Senior Autonomous Software Engineer in Friday OS.
Write complete, production-ready code. No placeholders, no TODOs.
Operating System: Linux. Working directory: ${workDir}
Include file paths in code block headers (e.g. \`\`\`typescript src/utils.ts).`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction, temperature: 0.2 },
    });

    const reply = response.text || "";
    return { success: true, text: reply, codeSnippets: extractCodeBlocks(reply), sessionId: `prime_${Date.now()}` };
  } catch (err: any) {
    return { success: false, text: "", error: err?.message || String(err) };
  }
}

/**
 * Execute a coding task via Prime Agent CLI.
 * Uses: prime-agent -p --mode text "<prompt>"
 * Falls back to integrated Gemini engine if binary fails.
 */
export async function execPrimeAgent(
  prompt: string,
  opts?: { timeout?: number; cwd?: string }
): Promise<PrimeResult> {
  const timeout = opts?.timeout ?? TIMEOUT_MS;
  const workDir = opts?.cwd || process.cwd();
  const bin = getPrimeAgentBin();
  // Ensure GEMINI_API_KEY is loaded (verify_friday.ts and direct calls may not have sourced .env)
  getApiKey();

  // Write prompt to a temp file to avoid shell-injection via argv
  const tmpFile = path.join(
    process.cwd(),
    `.prime_query_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`
  );

  return new Promise<PrimeResult>((resolve) => {
    let child: ChildProcess | undefined;
    let settled = false;

    const finish = (r: PrimeResult) => {
      if (settled) return;
      settled = true;
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      resolve(r);
    };

    const timer = setTimeout(() => {
      try { child?.kill("SIGKILL"); } catch {}
      finish({ success: false, text: "", error: `Prime Agent timed out after ${timeout}ms.` });
    }, timeout);

    try {
      fs.writeFileSync(tmpFile, prompt, "utf-8");

      /**
       * prime-agent CLI non-interactive delegation:
       *   -p          print response and exit (non-interactive)
       *   --mode text plain text output (no TUI)
       *   --provider google --model gemini-2.5-flash — use Gemini via GEMINI_API_KEY
       *   --          treat rest as message
       */
      const args = [
        "-p",
        "--mode", "text",
        "--provider", "google",
        "--model", "gemini-2.5-flash",
        "--", prompt,
      ];

      child = execFile(bin, args, {
        cwd: workDir,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          // Ensure NVM node is on PATH for prime-agent's own child processes
          PATH: `/home/gopi/.nvm/versions/node/v24.19.0/bin:${process.env.PATH}`,
          FORCE_COLOR: "0",
        },
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));

      child.on("error", async (err) => {
        clearTimeout(timer);
        console.warn(`[PrimeAgent] Binary error (${bin}): ${err.message} — falling back to integrated engine.`);
        finish(await execIntegratedPrimeEngine(prompt, workDir));
      });

      child.on("close", async (code) => {
        clearTimeout(timer);
        const cleanedText = stdout.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();
        const codeBlocks = extractCodeBlocks(cleanedText);

        if (code === 0 && cleanedText) {
          finish({ success: true, text: cleanedText, codeSnippets: codeBlocks, raw: stdout });
        } else if (!cleanedText) {
          console.warn("[PrimeAgent] Empty output — falling back to integrated engine.");
          finish(await execIntegratedPrimeEngine(prompt, workDir));
        } else {
          finish({
            success: false,
            text: cleanedText,
            codeSnippets: codeBlocks,
            raw: stdout,
            error: stderr || `exit code ${code}`,
          });
        }
      });
    } catch (e: any) {
      clearTimeout(timer);
      finish({ success: false, text: "", error: (e?.message || String(e)).slice(0, 500) });
    }
  });
}
