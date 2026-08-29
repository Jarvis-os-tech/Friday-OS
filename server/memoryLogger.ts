import fs from "fs";
import path from "path";
import { getVaultPath } from "./hermesBridge.js";

/**
 * Ensure the memory vault exists and return its absolute path.
 */
export function ensureMemoryVault(): string {
  const vault = getVaultPath();
  if (!fs.existsSync(vault)) {
    fs.mkdirSync(vault, { recursive: true });
  }
  const subdirs = ["facts", "knowledge", "conversations", "execution", "Research", "skills", "summaries"];
  for (const dir of subdirs) {
    const fullDir = path.join(vault, dir);
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }
  }
  return vault;
}

/**
 * Returns all markdown files inside the vault recursively.
 */
export function getAllVaultMarkdownFiles(dir: string = ensureMemoryVault(), baseDir: string = dir): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllVaultMarkdownFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relPath = path.relative(baseDir, fullPath);
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Get formatted local date string (YYYY-MM-DD) and time string (HH:MM:SS).
 */
function getTimestampParts() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);
  return { dateStr, timeStr };
}

/**
 * Log a spoken or typed dialogue turn to friday-memory/conversations/YYYY-MM-DD.md.
 */
export function logDialogueTurn(speaker: "User" | "Friday" | "System", text: string): void {
  try {
    const vault = ensureMemoryVault();
    const { dateStr, timeStr } = getTimestampParts();
    const convDir = path.join(vault, "conversations");
    if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });

    const filePath = path.join(convDir, `${dateStr}.md`);
    if (!fs.existsSync(filePath)) {
      const header = `---
title: "Daily Conversation Log: ${dateStr}"
type: "conversation-log"
date: "${dateStr}"
session: "FRIDAY-SOVEREIGN-MK7"
operator: "Gopi"
status: "active"
created_at: "${new Date().toISOString()}"
---

# 💬 F.R.I.D.A.Y. Operational Conversation Log — ${dateStr}

- **Operator**: [[USER.md|Gopi]]
- **System**: [[MEMORY.md|F.R.I.D.A.Y. Sovereign MK-VII]]
- **Date**: ${dateStr}
- **Master Vault**: [[INDEX.md|FRIDAY Universal Memory Vault]]

---

## 📝 Real-Time Dialog Transcript

`;
      fs.writeFileSync(filePath, header, "utf-8");
    }

    const speakerIcon = speaker === "Friday" ? "🤖 [Friday]" : speaker === "User" ? "👤 [Operator]" : "⚡ [System]";
    const cleanText = text.trim();
    if (!cleanText) return;

    const entry = `### [${timeStr}] ${speakerIcon}\n${cleanText}\n\n`;
    fs.appendFileSync(filePath, entry, "utf-8");
  } catch (err) {
    console.warn("Failed to log dialogue turn to friday-memory:", err);
  }
}

/**
 * Log a tool execution to friday-memory/execution/YYYY-MM-DD.md.
 */
export function logExecutionTrace(
  toolName: string,
  args: any,
  result: any,
  durationMs: number,
  success: boolean
): void {
  try {
    const vault = ensureMemoryVault();
    const { dateStr, timeStr } = getTimestampParts();
    const execDir = path.join(vault, "execution");
    if (!fs.existsSync(execDir)) fs.mkdirSync(execDir, { recursive: true });

    const filePath = path.join(execDir, `${dateStr}.md`);
    if (!fs.existsSync(filePath)) {
      const header = `---
title: "Daily Tool Execution Log: ${dateStr}"
type: "execution-telemetry"
date: "${dateStr}"
operator: "Gopi"
created_at: "${new Date().toISOString()}"
---

# 🛠️ F.R.I.D.A.Y. Daily Tool & Actuator Telemetry — ${dateStr}

- **Operator**: [[USER.md|Gopi]]
- **Active Dialogue**: [[conversations/${dateStr}|Today's Dialogue]]
- **Session Index**: [[INDEX.md|Universal Index]]

---

## ⏱️ Execution Timeline

`;
      fs.writeFileSync(filePath, header, "utf-8");
    }

    const statusBadge = success ? "✅ SUCCESS" : "❌ FAILED";
    const argsStr = typeof args === "object" ? JSON.stringify(args) : String(args);
    let summaryStr = "";
    if (result && typeof result === "object") {
      summaryStr = result.speechSummary || result.summary || JSON.stringify(result).slice(0, 200);
    } else if (result) {
      summaryStr = String(result).slice(0, 200);
    }

    const entry = `### [${timeStr}] ⚙️ \`${toolName}\` — ${statusBadge}
- **Duration**: \`${durationMs.toFixed(1)}ms\`
- **Arguments**: \`${argsStr.slice(0, 300)}\`
- **Summary**: ${summaryStr.replace(/\n/g, " ")}

`;
    fs.appendFileSync(filePath, entry, "utf-8");
  } catch (err) {
    console.warn("Failed to log execution trace to friday-memory:", err);
  }
}

/**
 * Load core operator profile and memory context to inject into Friday's system prompt.
 */
export function getCoreMemoryPromptContext(): string {
  try {
    const vault = ensureMemoryVault();
    let promptSections: string[] = [];

    const userProfilePath = path.join(vault, "USER.md");
    if (fs.existsSync(userProfilePath)) {
      promptSections.push(`[OPERATOR PROFILE FROM FRIDAY-MEMORY]\n${fs.readFileSync(userProfilePath, "utf-8").trim()}`);
    }

    const factsDir = path.join(vault, "facts");
    if (fs.existsSync(factsDir)) {
      const factFiles = fs.readdirSync(factsDir).filter((f) => f.endsWith(".md"));
      for (const file of factFiles) {
        const content = fs.readFileSync(path.join(factsDir, file), "utf-8").trim();
        promptSections.push(`[FACT: ${file.replace(".md", "")}]\n${content}`);
      }
    }

    return promptSections.join("\n\n");
  } catch (err) {
    console.warn("Failed to load core memory prompt context:", err);
    return "";
  }
}

/**
 * Search the memory vault recursively.
 */
export function searchMemoryVault(query: string, limit: number = 8): Array<{ file: string; snippet: string; fullPath: string }> {
  const vault = ensureMemoryVault();
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];

  const files = getAllVaultMarkdownFiles(vault);
  const results: Array<{ file: string; snippet: string; fullPath: string }> = [];

  for (const file of files) {
    try {
      const fullPath = path.join(vault, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      const lower = content.toLowerCase();
      if (lower.includes(q) || file.toLowerCase().includes(q)) {
        let snippet = "";
        const idx = lower.indexOf(q);
        if (idx !== -1) {
          snippet = content
            .slice(Math.max(0, idx - 80), idx + 140)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
        } else {
          snippet = content.slice(0, 180).replace(/\s+/g, " ").trim();
        }
        results.push({ file, snippet, fullPath });
        if (results.length >= limit) break;
      }
    } catch {}
  }
  return results;
}

/**
 * Read a note from the vault. Tries direct relative path, then searches subfolders if needed.
 */
export function readMemoryNote(targetPath: string): { found: boolean; path: string; content: string } {
  const vault = ensureMemoryVault();
  let rel = (targetPath || "").trim().replace(/^[\\/]+/, "");
  if (!rel.endsWith(".md")) rel += ".md";

  // 1. Direct path check
  const directPath = path.join(vault, rel);
  if (fs.existsSync(directPath)) {
    return { found: true, path: rel, content: fs.readFileSync(directPath, "utf-8") };
  }

  // 2. Search all files in vault matching filename
  const baseName = path.basename(rel);
  const allFiles = getAllVaultMarkdownFiles(vault);
  for (const f of allFiles) {
    if (path.basename(f) === baseName || f === rel || f.toLowerCase() === rel.toLowerCase()) {
      const full = path.join(vault, f);
      return { found: true, path: f, content: fs.readFileSync(full, "utf-8") };
    }
  }

  return { found: false, path: rel, content: "" };
}
