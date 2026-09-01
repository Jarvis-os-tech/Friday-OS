import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration, StartSensitivity, EndSensitivity } from "@google/genai";
import { createServer as createViteServer } from "vite";
import {
  MODULAR_SKILLS,
  getAllSkillDeclarations,
  executeSkillByName,
  getRemindersStore,
} from "./server/skills";
import { checkHermesHealth, execHermes, getVaultPath } from "./server/hermesBridge.js";
import { checkPrimeHealth, execPrimeAgent } from "./server/primeBridge.js";
import { runUltronSystemAction, runUltronDeepAudit, getOpenClawStatus } from "./server/ultronBridge.js";
import {
  writeMemoryEntry,
  readMemoryEntry,
  searchMemory,
  listDepartments,
  DEPARTMENTS,
  loadIndex,
} from "./server/memoryGuard.js";
import { parallelTaskManager } from "./server/parallelTaskManager";
import {
  getCoreMemoryPromptContext,
  logDialogueTurn,
  logExecutionTrace,
  ensureMemoryVault,
  searchMemoryVault,
  readMemoryNote,
  getAllVaultMarkdownFiles,
} from "./server/memoryLogger.js";
import {
  startHeartbeat,
  stopHeartbeat,
  getHeartbeatStatus,
  forceHeartbeatTick,
} from "./server/heartbeat.js";
import {
  isTelegramConfigured,
  verifyTelegramBot,
  sendTelegramMessage,
} from "./server/telegramNotifier.js";
import {
  startTelegramBot,
  stopTelegramBot,
  getTelegramBotStatus,
} from "./server/telegramBot.js";
import {
  getMasterRegistry,
  getRegisteredAgents,
  getRegisteredSkills,
  getRegisteredTools,
  getRegistryStats,
  generateSystemPromptRegistry,
} from "./server/registry.js";
import {
  getSystemTelemetryGroundTruth,
  getBatteryStatus,
  getSystemVolume,
  setSystemVolume,
  diagnoseSoundServer,
  healSoundServer,
  getScreenBrightness,
  setScreenBrightness,
  getThermalSensors,
  getDetailedStorageUsage,
  launchApplication,
  listInstalledApplications,
  getRunningProcesses,
  manageProcess,
  getPowerProfile,
  setPowerProfile,
  getNetworkStatusGroundTruth,
  controlMediaPlayback,
  systemPowerAction,
  sendDesktopNotification,
  executeSystemCommand,
  searchLocalFiles,
  readLocalFile,
  writeLocalFile,
  takeScreenshot,
  getPcSpecGroundTruth,
  getFirewallStatus,
  desktopControlAction,
  manageSystemdService,
  getSystemLogs,
  managePackages,
  getNetworkConnections,
  listDirectory,
  deleteLocalFile,
  clipboardControl,
  getEnvironmentInfo,
} from "./server/system_controller";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config();

const getApiKey = () => {
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
    } catch (e) {}
  }
  if (key) {
    key = key.replace(/^["']|["']$/g, "").trim();
  }
  return key;
};

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json({ limit: "10mb" }));

// Lightweight health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Check if API key is configured on server
app.get("/api/config", (req, res) => {
  res.json({
    hasApiKey: Boolean(getApiKey()),
  });
});

// Initialize GoogleGenAI client
const getAiClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is missing in .env file.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// Available Voice Presets with prosody characteristics
const VOICE_PRESETS = [
  {
    id: "Zephyr",
    name: "Zephyr",
    gender: "Neutral / Warm",
    tone: "Articulate, Balanced & Eloquent",
    description: "Natural, smooth cadence ideal for deep discussions and friendly explanations.",
    badge: "Recommended",
  },
  {
    id: "Puck",
    name: "Puck",
    gender: "Playful / Bright",
    tone: "Energetic, Enthusiastic & Dynamic",
    description: "Upbeat and lively prosody with expressive pitch variations.",
    badge: "Fast & Expressive",
  },
  {
    id: "Kore",
    name: "Kore",
    gender: "Calm / Melodic",
    tone: "Gentle, Empathetic & Thoughtful",
    description: "Soothing tone with gentle cadence, great for tutorials and mindful talks.",
    badge: "Calming",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    gender: "Deep / Resonant",
    tone: "Confident, Authoritative & Grounded",
    description: "Rich, deep voice with commanding presence and clear diction.",
    badge: "Deep Resonance",
  },
  {
    id: "Charon",
    name: "Charon",
    gender: "Mellow / Analytical",
    tone: "Measured, Academic & Precise",
    description: "Steady, analytical delivery suited for complex technical topics.",
    badge: "Precise",
  },
];

// Search & Research Trigger Keywords
const SEARCH_KEYWORDS = [
  "search", "searching", "searched", "research", "researching",
  "look up", "lookup", "find", "find out", "google", "browse",
  "latest", "recent", "news", "today", "yesterday", "current",
  "price", "prices", "stock", "stocks", "market", "weather", "forecast",
  "who is", "who won", "what is happening", "what happened",
  "facts", "investigate", "sources", "citations", "references",
  "compare", "documentation", "release date", "review", "score",
  "match", "schedule", "events", "trending", "headline", "stats",
  "statistics", "study", "papers", "articles"
];

const ULTRA_FAST_GREETINGS = [
  "hello", "hey", "hi", "how are you", "how are you doing", "how r u",
  "what is up", "what's up", "good morning", "good evening", "good afternoon", "good day",
  "who are you", "what is your name", "what are you", "tell me a joke", "say something",
  "thank you", "thanks", "cool", "awesome", "nice", "great", "ok", "okay", "yes", "no",
  "bye", "goodbye", "see you", "sup", "yo", "test", "ping", "can you hear me", "howdy"
];

const DIRECT_FAST_KEYWORDS = [
  // Coding & software engineering
  "function", "const", "let", "var", "def", "class", "import", "return", "bug", "fix", "debug",
  "error", "traceback", "exception", "stack", "syntax", "typescript", "javascript", "python", "rust",
  "sql", "query", "database", "schema", "api", "endpoint", "component", "regex", "algorithm",
  // Deep Mathematics, Physics, Logic
  "calculate", "solve", "equation", "derivative", "integral", "matrix", "vector", "proof", "theorem",
  "physics", "quantum", "probability", "statistics", "complexity", "big o", "puzzle", "riddle",
  // In-depth Architecture & Trade-offs
  "architecture", "trade-offs", "tradeoffs", "step by step", "step-by-step", "in-depth", "comprehensive",
  "deep dive", "system design", "compare and contrast", "benchmarks", "performance optimization",
  // Deep research & investigation
  "research", "analyze", "examine", "audit", "inspect", "investigate"
];

export interface ProcessingTier {
  id: "ultra_fast" | "balanced" | "direct_fast";
  name: string;
  badge: string;
  description: string;
  reason: string;
  thinkingBudget: number;
  color: string;
}

function detectConversationTier(
  prompt: string = "",
  attachments: any[] = [],
  history: any[] = []
): ProcessingTier {
  const cleanPrompt = (prompt || "").trim().toLowerCase();
  const wordCount = cleanPrompt ? cleanPrompt.split(/\s+/).length : 0;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  // 1. Direct Fast / Deep Multimodal Reasoning:
  // - Triggered by attachments (Images, Videos, PDFs, Folders, Code, Web Links)
  // - Code snippets, math logic, algorithms, deep analysis keywords
  // - Detailed structured queries (> 70 words or containing code syntax)
  if (hasAttachments) {
    const attTypes = attachments.map((a) => a.type || "file").join(", ");
    return {
      id: "direct_fast",
      name: "Direct Fast / Deep Reasoning",
      badge: "🧠 Direct Fast",
      description: "Dedicated multimodal reasoning budget for attached context.",
      reason: `Attached ${attachments.length} multi-input item(s) (${attTypes}) — auto-allocated Direct Fast reasoning`,
      thinkingBudget: 2048,
      color: "indigo",
    };
  }

  const hasDirectFastKeyword = DIRECT_FAST_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
    return regex.test(cleanPrompt);
  });

  const hasCodeCharacters = cleanPrompt.includes("```") || (/[\{\}\[\]\(\)=\>\<;]/.test(cleanPrompt) && wordCount > 4);

  if (hasDirectFastKeyword || hasCodeCharacters || wordCount > 70) {
    return {
      id: "direct_fast",
      name: "Direct Fast / Deep Reasoning",
      badge: "🧠 Direct Fast",
      description: "Deep reasoning budget for code, math calculations, and step-by-step algorithms.",
      reason: hasDirectFastKeyword
        ? "Analytical / programming / math logic detected — auto-allocated Direct Fast reasoning"
        : `Detailed multi-step prompt (${wordCount} words) — auto-allocated Direct Fast reasoning`,
      thinkingBudget: 2048,
      color: "indigo",
    };
  }

  // 2. Ultra Fast:
  // - Greetings, quick banter, simple questions (< 12 words)
  const isGreetingOrBanter = ULTRA_FAST_GREETINGS.some((phrase) => {
    return cleanPrompt === phrase || cleanPrompt.startsWith(phrase + " ") || cleanPrompt.endsWith(" " + phrase);
  });

  if (isGreetingOrBanter || (wordCount <= 7 && !hasDirectFastKeyword)) {
    return {
      id: "ultra_fast",
      name: "Ultra Fast",
      badge: "⚡ Ultra Fast",
      description: "Instant sub-100ms response with snappy conversational prosody.",
      reason: isGreetingOrBanter
        ? "Quick conversational greeting / banter — auto-routed to Ultra Fast speed"
        : `Short query (${wordCount} words) — auto-routed to Ultra Fast speed`,
      thinkingBudget: 0,
      color: "emerald",
    };
  }

  // 3. Balanced:
  // - General explanations, stories, everyday summaries, creative advice
  return {
    id: "balanced",
    name: "Balanced",
    badge: "⚖️ Balanced",
    description: "Balanced reasoning synthesis for articulate explanations and natural speech flow.",
    reason: "General knowledge & conversational inquiry — auto-routed to Balanced speed",
    thinkingBudget: 512,
    color: "amber",
  };
}

function detectSearchKeywords(text: string): { shouldSearch: boolean; matchedKeywords: string[] } {
  if (!text) return { shouldSearch: false, matchedKeywords: [] };
  const lower = text.toLowerCase();
  
  if (/https?:\/\/[^\s]+/.test(text)) {
    return { shouldSearch: true, matchedKeywords: ["web link"] };
  }
  
  const matched = SEARCH_KEYWORDS.filter((kw) => {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(lower);
  });
  
  return {
    shouldSearch: matched.length > 0,
    matchedKeywords: matched,
  };
}

function getTimeGreeting(clientHour?: number): { greeting: string; timePeriod: string; text: string } {
  const hour = typeof clientHour === "number" && !isNaN(clientHour) ? clientHour : new Date().getHours();
  let greeting = "Good morning";
  let timePeriod = "morning";
  let text = "Good morning! F.R.I.D.A.Y. online. Systems operational, ready for your command.";

  if (hour >= 12 && hour < 17) {
    greeting = "Good afternoon";
    timePeriod = "afternoon";
    text = "Good afternoon! F.R.I.D.A.Y. standing by. What are we working on, Boss?";
  } else if (hour >= 17 && hour < 22) {
    greeting = "Good evening";
    timePeriod = "evening";
    text = "Good evening! F.R.I.D.A.Y. online. How can I assist you tonight?";
  } else if (hour >= 22 || hour < 5) {
    greeting = "Good evening";
    timePeriod = "night";
    text = "Late night in the lab? F.R.I.D.A.Y. is ready when you are.";
  }

  return { greeting, timePeriod, text };
}

// Resilient helper with retry and multi-model fallback to withstand 503 high-demand spikes
async function generateContentWithRetryAndFallback(
  ai: GoogleGenAI,
  baseParams: { contents: any; config?: any },
  candidateModels: string[] = ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"]
): Promise<{ response: any; usedModel: string }> {
  let lastError: any = null;

  for (const model of candidateModels) {
    // Clone config for current candidate model
    const config = { ...baseParams.config };

    // Optimize thinkingConfig based on candidate model support
    if (model === "gemini-3.1-flash-lite") {
      delete config.thinkingConfig;
    }

    // Try up to 2 attempts per candidate model with backoff
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: baseParams.contents,
          config,
        });
        return { response, usedModel: model };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isUnavailableOrRateLimited =
          errMsg.includes("503") ||
          errMsg.includes("UNAVAILABLE") ||
          errMsg.includes("high demand") ||
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED");

        console.warn(`[AI Fallback] Model ${model} attempt ${attempt} failed: ${errMsg}`);

        if (attempt < 2 && isUnavailableOrRateLimited) {
          // Short exponential backoff before retry
          await new Promise((res) => setTimeout(res, 400 * attempt));
        } else {
          // Move to next candidate model
          break;
        }
      }
    }
  }

  throw lastError || new Error("All AI models are temporarily unavailable.");
}

// Health Check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// Time-aware Greeting endpoint
app.post("/api/chat/greet", async (req, res) => {
  try {
    const { clientHour, voiceName = "Zephyr" } = req.body;
    const { greeting, timePeriod, text } = getTimeGreeting(clientHour);

    let audio: string | undefined = undefined;
    try {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (ttsErr) {
      console.warn("Greeting TTS preview error:", ttsErr);
    }

    res.json({
      greeting,
      timePeriod,
      text,
      audio,
      mimeType: "audio/pcm;rate=24000",
    });
  } catch (error: any) {
    console.error("Error in /api/chat/greet:", error);
    res.status(500).json({ error: error.message || "Failed to generate greeting" });
  }
});

// Voice Profiles endpoint
app.get("/api/voices", (req, res) => {
  res.json({ voices: VOICE_PRESETS });
});

// Modular Skills catalog endpoint
app.get("/api/skills", (req, res) => {
  const skillsList = Object.values(MODULAR_SKILLS).map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    category: s.category,
    icon: s.icon,
  }));
  res.json({ skills: skillsList });
});

// Execute skill on-demand via REST
app.post("/api/skills/execute", async (req, res) => {
  try {
    const { skillName, args = {} } = req.body;
    if (!skillName) {
      return res.status(400).json({ error: "skillName is required." });
    }
    const result = await executeSkillByName(skillName, args);
    res.json(result);
  } catch (err: any) {
    console.error("Error executing skill via REST:", err);
    res.status(500).json({ error: err.message || "Failed to execute skill" });
  }
});

// ── Hermes Bridge REST ─────────────────────────────────────
app.get("/api/hermes/health", async (req, res) => {
  const h = await checkHermesHealth();
  const connected = h.ok && !!h.gateway?.reachable;
  res.json({
    hermes: h,
    connected, // true when the hermes binary is present AND the serve gateway is reachable
    delegation: h.ok ? "ready" : "unavailable",
    vault: getVaultPath(),
    vaultExists: fs.existsSync(getVaultPath()),
  });
});

app.post("/api/hermes/chat", async (req, res) => {
  try {
    const { prompt, maxTurns, yolo } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    const r = await execHermes(prompt, {
      maxTurns: typeof maxTurns === "number" ? maxTurns : undefined,
      yolo: yolo !== false,
    });
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Hermes chat failed" });
  }
});

// ── Prime Agent Bridge REST ────────────────────────────────
app.get("/api/prime/health", async (req, res) => {
  const h = await checkPrimeHealth();
  res.json(h);
});

app.post("/api/prime/chat", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    const r = await execPrimeAgent(prompt);
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Prime Agent chat failed" });
  }
});

// ── Ultron OS Diagnostics & Boost REST ─────────────────────
app.get("/api/ultron/status", async (req, res) => {
  try {
    const [openclaw, audit] = await Promise.all([getOpenClawStatus(), runUltronDeepAudit()]);
    res.json({
      openclaw,
      healthScore: audit.healthScore,
      overallStatus: audit.overallStatus,
      telemetry: audit.telemetry,
      bottlenecks: audit.bottlenecks,
      openClawGatewayRunning: openclaw.gatewayRunning,
      openClawModel: openclaw.primaryModel,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Ultron status query failed" });
  }
});

app.post("/api/ultron/execute", async (req, res) => {
  try {
    const { action = "deep_audit", params } = req.body || {};
    const r = await runUltronSystemAction(action, params);
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Ultron execution failed" });
  }
});

// ── OpenClaw REST ────────────────────────────────────────────
app.get("/api/openclaw/status", async (req, res) => {
  try {
    const { getOpenClawStatus } = await import("./server/ultronBridge.js");
    const status = await getOpenClawStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "OpenClaw status failed" });
  }
});

app.post("/api/openclaw/delegate", async (req, res) => {
  try {
    const { prompt, timeout } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required" });
    const r = await runUltronSystemAction("openclaw_delegate", { prompt, timeout });
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "OpenClaw delegation failed" });
  }
});

// ── Heartbeat & Proactive Autonomous Engine REST ───────────
app.get("/api/heartbeat/status", (req, res) => {
  try {
    const status = getHeartbeatStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get heartbeat status" });
  }
});

app.post("/api/heartbeat/tick", async (req, res) => {
  try {
    const tickResult = await forceHeartbeatTick();
    res.json({ ok: true, result: tickResult });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Heartbeat tick execution failed" });
  }
});

// ── Telegram Notification Channel REST ─────────────────────
app.get("/api/telegram/status", async (req, res) => {
  try {
    const configured = isTelegramConfigured();
    const bot = configured ? await verifyTelegramBot() : { ok: false, error: "Not configured" };
    res.json({ configured, bot });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Telegram status probe failed" });
  }
});

app.get("/api/telegram/bot", (req, res) => {
  try {
    const status = getTelegramBotStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get Telegram bot status" });
  }
});

app.post("/api/telegram/test", async (req, res) => {
  try {
    const { text } = req.body || {};
    const messageText = text || "🔔 Test notification from Friday OS Proactive Engine.";
    const sent = await sendTelegramMessage(messageText);
    res.json({ ok: sent, message: sent ? "Telegram notification dispatched successfully" : "Telegram notification failed or not configured" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to send test Telegram message" });
  }
});

// Telegram Bot (inbound commands) REST endpoints
app.get("/api/telegram/bot/status", (req, res) => {
  try {
    const status = getTelegramBotStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get Telegram bot status" });
  }
});

app.post("/api/telegram/bot/start", async (req, res) => {
  try {
    await startTelegramBot();
    res.json({ ok: true, message: "Telegram bot started" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to start Telegram bot" });
  }
});

app.post("/api/telegram/bot/stop", (req, res) => {
  try {
    stopTelegramBot();
    res.json({ ok: true, message: "Telegram bot stopped" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to stop Telegram bot" });
  }
});

// ── Agent, Skills & Tools Master Registry REST ─────────────
app.get("/api/registry", (req, res) => {
  try {
    const registry = getMasterRegistry();
    const stats = getRegistryStats();
    res.json({ ...stats, registry });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load master registry" });
  }
});

app.get("/api/registry/agents", (req, res) => {
  try {
    const agents = getRegisteredAgents();
    res.json({ count: agents.length, agents });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get registered agents" });
  }
});

app.get("/api/registry/skills", (req, res) => {
  try {
    const skills = getRegisteredSkills();
    res.json({ count: skills.length, skills });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get registered skills" });
  }
});

app.get("/api/registry/tools", (req, res) => {
  try {
    const tools = getRegisteredTools();
    res.json(tools);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get registered tools" });
  }
});

app.get("/api/registry/prompt-summary", (req, res) => {
  try {
    const promptSummary = generateSystemPromptRegistry();
    res.type("text/plain").send(promptSummary);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate prompt summary" });
  }
});

// Friday Sovereign Memory Vault REST endpoints
app.get("/api/memory/stats", (req, res) => {
  try {
    const vault = ensureMemoryVault();
    const files = getAllVaultMarkdownFiles(vault);
    const facts = files.filter((f) => f.startsWith("facts/"));
    const knowledge = files.filter((f) => f.startsWith("knowledge/"));
    const conversations = files.filter((f) => f.startsWith("conversations/"));
    const execution = files.filter((f) => f.startsWith("execution/"));
    const research = files.filter((f) => f.startsWith("Research/"));
    const skills = files.filter((f) => f.startsWith("skills/"));

    res.json({
      success: true,
      vaultPath: vault,
      totalNotes: files.length,
      categories: {
        facts: facts.length,
        knowledge: knowledge.length,
        conversations: conversations.length,
        execution: execution.length,
        research: research.length,
        skills: skills.length,
      },
      latestFiles: files.slice(0, 20),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/profile", (req, res) => {
  try {
    const context = getCoreMemoryPromptContext();
    res.json({ success: true, profile: context });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/search", (req, res) => {
  const q = (req.query.q as string) || "";
  const limit = Number(req.query.limit) || 8;
  const results = searchMemoryVault(q, limit);
  res.json({ success: true, query: q, results });
});

app.get("/api/memory/note", (req, res) => {
  const p = (req.query.path as string) || "";
  const result = readMemoryNote(p);
  res.json({ success: result.found, ...result });
});

// Obsidian direct REST (fast path)
app.get("/api/obsidian/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  const result = await executeSkillByName("obsidian_search", { query: q, limit: 8 });
  res.json(result);
});
app.get("/api/obsidian/note", async (req, res) => {
  const p = (req.query.path as string) || "";
  const result = await executeSkillByName("obsidian_read", { path: p });
  res.json(result);
});

// Friday-OS Federated Memory REST endpoints (department-scoped)
app.get("/api/memory/departments", (req, res) => {
  try {
    res.json({ success: true, departments: listDepartments() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/department/:dept", async (req, res) => {
  try {
    const dept = req.params.dept;
    if (!DEPARTMENTS.includes(dept)) {
      return res.status(404).json({ error: `Unknown department: ${dept}` });
    }
    const index = loadIndex(dept);
    res.json({ success: true, department: dept, count: index.entries.length, entries: index.entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/department/:dept/entry/:id", (req, res) => {
  try {
    const dept = req.params.dept;
    const id = req.params.id;
    if (!DEPARTMENTS.includes(dept)) {
      return res.status(404).json({ error: `Unknown department: ${dept}` });
    }
    const entry = readMemoryEntry(dept, id);
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memory/department/:dept/write", async (req, res) => {
  try {
    const dept = req.params.dept;
    if (!DEPARTMENTS.includes(dept)) {
      return res.status(404).json({ error: `Unknown department: ${dept}` });
    }
    const { type, title, tags } = req.body;
    if (!type || !title) {
      return res.status(400).json({ error: "type and title required" });
    }
    // Caller is "friday" (this server acts as Friday gateway)
    const entry = writeMemoryEntry(dept, "friday", { type, title, tags: Array.isArray(tags) ? tags : [], owner: "friday" });
    res.json({ success: true, entry });
  } catch (err: any) {
    if (err.message.includes("Write denied")) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memory/search", (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    const dept = (req.query.dept as string) || undefined;
    const type = (req.query.type as string) || undefined;
    const tags = req.query.tags
      ? Array.isArray(req.query.tags)
        ? (req.query.tags as string[])
        : [String(req.query.tags)]
      : undefined;
    const results = searchMemory({ text: q, type, tags }, dept);
    res.json({ success: true, query: q, department: dept, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// Reminders REST endpoints
app.get("/api/reminders", (req, res) => {
  const all = getRemindersStore();
  res.json({ reminders: all });
});

app.post("/api/reminders", async (req, res) => {
  try {
    const { action = "create", text, due_in_minutes, due_time_string, reminder_id } = req.body;
    const result = await executeSkillByName("manage_reminders", {
      action,
      text,
      due_in_minutes,
      due_time_string,
      reminder_id,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to manage reminder" });
  }
});

// Parallel Task Execution REST endpoints
app.get("/api/tasks", (req, res) => {
  res.json({
    activeTasks: parallelTaskManager.getActiveTasks(),
    completedTasks: parallelTaskManager.getCompletedTasks(),
  });
});

app.post("/api/tasks/run", async (req, res) => {
  try {
    const { skillName, args = {}, category, title, prompt } = req.body;
    if (!skillName && !prompt) {
      return res.status(400).json({ error: "skillName or prompt is required" });
    }
    const task = await parallelTaskManager.executeParallelTask({
      skillName,
      args,
      category,
      title,
      prompt,
    });
    res.status(202).json({
      message: "Task initiated in parallel",
      task,
      verbalAcknowledgment: task.verbalAcknowledgment,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to execute parallel task" });
  }
});

app.post("/api/tasks/:id/cancel", (req, res) => {
  const success = parallelTaskManager.cancelTask(req.params.id);
  res.json({ success });
});

// ─── System Control API Routes (Phase 1 — C++ Native Workers) ───────────────

app.get("/api/system/telemetry", async (req, res) => {
  try {
    const data = await getSystemTelemetryGroundTruth();
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/hardware", async (req, res) => {
  try {
    const [volume, brightness, battery, thermals] = await Promise.all([
      getSystemVolume(), getScreenBrightness(), getBatteryStatus(), getThermalSensors()
    ]);
    res.json({ volume, brightness, battery, thermals });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/volume", async (req, res) => {
  try {
    const { level } = req.body;
    const result = await setSystemVolume(level);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/brightness", async (req, res) => {
  try {
    const { level } = req.body;
    const result = await setScreenBrightness(level);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/sound-health", async (req, res) => {
  try {
    const status = await diagnoseSoundServer();
    res.json(status);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/sound-heal", async (req, res) => {
  try {
    const result = await healSoundServer();
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/spec", async (req, res) => {
  try {
    const spec = await getPcSpecGroundTruth();
    res.json(spec);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/apps", async (req, res) => {
  try {
    const apps = await listInstalledApplications();
    res.json(apps);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/launch", async (req, res) => {
  try {
    const { appName } = req.body;
    const result = await launchApplication(appName);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/processes", async (req, res) => {
  try {
    const { sortBy, limit } = req.query as any;
    const procs = await getRunningProcesses({ sortBy: sortBy || 'cpu', limit: limit ? Number(limit) : 50 });
    res.json(procs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/processes/manage", async (req, res) => {
  try {
    const { action, target, pid, processName, signal } = req.body;
    const effectivePid = pid || (typeof target === 'number' ? target : undefined);
    const effectiveName = processName || (typeof target === 'string' ? target : undefined);
    const signalMap: Record<string, "SIGTERM" | "SIGKILL" | "SIGSTOP" | "SIGCONT"> = {
      kill: "SIGKILL",
      terminate: "SIGTERM",
      suspend: "SIGSTOP",
      resume: "SIGCONT"
    };
    const effectiveSignal = signal || signalMap[action || 'kill'] || "SIGTERM";
    const result = await manageProcess({ pid: effectivePid, processName: effectiveName, signal: effectiveSignal });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/power-profile", async (req, res) => {
  try {
    const profile = await getPowerProfile();
    res.json(profile);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/power-profile", async (req, res) => {
  try {
    const { profile } = req.body;
    const result = await setPowerProfile(profile);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/power-action", async (req, res) => {
  try {
    const { action } = req.body;
    const result = await systemPowerAction(action);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/storage", async (req, res) => {
  try {
    const storage = await getDetailedStorageUsage();
    res.json(storage);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/thermals", async (req, res) => {
  try {
    const thermals = await getThermalSensors();
    res.json(thermals);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/connections", async (req, res) => {
  try {
    const net = await getNetworkConnections();
    res.json(net);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/network", async (req, res) => {
  try {
    const net = await getNetworkStatusGroundTruth();
    res.json(net);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/firewall", async (req, res) => {
  try {
    const fw = await getFirewallStatus();
    res.json(fw);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/logs", async (req, res) => {
  try {
    const { unit, lines, priority } = req.query as any;
    const logs = await getSystemLogs({ unit: unit || "", lines: lines ? Number(lines) : 50, priority: priority || "" });
    res.json(logs);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/services", async (req, res) => {
  try {
    const { action, serviceName, unit } = req.query as any;
    const result = await manageSystemdService({ action: action || "status", unit: serviceName || unit || "" });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/exec", async (req, res) => {
  try {
    const { command, timeout } = req.body;
    const result = await executeSystemCommand({ command, timeoutMs: timeout });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/control", async (req, res) => {
  try {
    const { action, target } = req.body;
    const result = await desktopControlAction({ action, target });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/screenshot", async (req, res) => {
  try {
    const { target } = req.body;
    const result = await takeScreenshot(target || "fullscreen");
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/notify", async (req, res) => {
  try {
    const { title, body, message, urgency } = req.body;
    const result = await sendDesktopNotification({ title: title || "Friday", message: body || message || "", urgency: urgency || "normal" });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/media", async (req, res) => {
  try {
    const { action } = req.body;
    const result = await controlMediaPlayback(action);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/clipboard", async (req, res) => {
  try {
    const { action, content, text } = req.body;
    const result = await clipboardControl({ action: action || 'read', text: content || text });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/files/search", async (req, res) => {
  try {
    const { query, pattern, directory, maxResults } = req.body;
    const result = await searchLocalFiles({ pattern: pattern || query || "", rootDir: directory, maxResults: maxResults ? Number(maxResults) : 20 });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/files/read", async (req, res) => {
  try {
    const { filePath } = req.body;
    const result = await readLocalFile(filePath);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/files/write", async (req, res) => {
  try {
    const { filePath, content } = req.body;
    const result = await writeLocalFile({ filePath, content: content || "" });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/files/delete", async (req, res) => {
  try {
    const { filePath } = req.body;
    const result = await deleteLocalFile(filePath);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/files/list", async (req, res) => {
  try {
    const { directory } = req.query as any;
    const result = await listDirectory(directory || process.cwd());
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post("/api/system/packages", async (req, res) => {
  try {
    const { action, packageName } = req.body;
    const result = await managePackages({ action: action || 'check', packageName: packageName || '' });
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system/env", async (req, res) => {
  try {
    const info = await getEnvironmentInfo();
    res.json(info);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Modular skill tool execution endpoint
app.post("/api/tools/execute", async (req, res) => {
  try {
    const { toolName, skillName, args } = req.body;
    const target = skillName || toolName;
    const result = await executeSkillByName(target, args || {});
    res.json(result);
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// Parse link endpoint: fetches title, description, and readable body text for URL attachments
app.post("/api/parse-link", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    const parsed = new URL(targetUrl);
    const domain = parsed.hostname;

    let html = "";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      clearTimeout(timeout);
      if (response.ok) {
        html = await response.text();
      }
    } catch (fetchErr) {
      // Continue with domain fallback
    }

    let title = domain;
    let description = "";
    let cleanText = "";

    if (html) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim().replace(/\s+/g, " ");
      }

      const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
      if (metaDesc && metaDesc[1]) {
        description = metaDesc[1].trim();
      }

      const stripped = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      cleanText = stripped.slice(0, 4000);
    }

    res.json({
      url: targetUrl,
      domain,
      title,
      description,
      cleanText,
      favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    });
  } catch (error: any) {
    console.error("Error in /api/parse-link:", error);
    res.status(500).json({ error: error.message || "Failed to parse link" });
  }
});

// Flash reasoning + Text + Multi-Input Attachments + Auto Search Grounding + Adaptive Tiering
app.post("/api/chat/flash", async (req, res) => {
  try {
    const { prompt = "", history = [], systemInstruction, enableSearch, attachments = [] } = req.body;

    const detected = detectSearchKeywords(prompt);
    const hasLinkAttachment = Array.isArray(attachments) && attachments.some((a: any) => a.type === "link");
    const shouldSearch = enableSearch !== undefined ? Boolean(enableSearch) : (detected.shouldSearch || hasLinkAttachment);

    // Auto-detect Processing Tier (Ultra Fast vs. Balanced vs. Direct Fast) based on conversation context & input
    const autoTier = detectConversationTier(prompt, attachments, history);

    const ai = getAiClient();
    const tools: any[] = [];
    if (shouldSearch) {
      tools.push({ googleSearch: {} });
    }

    let tierInstruction = "";
    if (autoTier.id === "ultra_fast") {
      tierInstruction = "\n[AUTO-EXECUTION TIER: ULTRA FAST] Respond with instant, crisp, high-tempo conversational prosody without excessive verbosity.";
    } else if (autoTier.id === "balanced") {
      tierInstruction = "\n[AUTO-EXECUTION TIER: BALANCED] Deliver a balanced, articulate, and engaging spoken explanation with natural cadence.";
    } else {
      tierInstruction = "\n[AUTO-EXECUTION TIER: DIRECT FAST / DEEP REASONING] Perform deep analytical reasoning, inspect all attached files/code/data carefully, and provide rigorous step-by-step clarity.";
    }

    const fullInstruction = `${
      systemInstruction ||
      "You are F.R.I.D.A.Y., the user's sovereign Digital Voice Partner and 24/7 Personal AI Manager. You manage the daily agenda, guide priorities ('what to do and when to do it'), handle fast tasks (<1-2s) directly, and delegate heavy coding, testing, and product building to Prime Agent, deep research to Hermes, and system optimization to Ultron."
    }${tierInstruction}
Respond clearly, naturally, and concisely with sharp conversational prosody.
When analyzing multi-input attachments (images, videos, documents, code files, folders, or web links), provide precise, thorough, and insightful answers.
When Google Search grounding is active, incorporate live, up-to-date facts and sources directly into your response seamlessly.`;

    const userParts: any[] = [];

    // Process multi-input attachments (Images, Videos, Audio, Documents, Folders, Links)
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        if (
          att.type === "image" ||
          att.type === "video" ||
          att.type === "audio" ||
          (att.type === "document" && att.mimeType === "application/pdf")
        ) {
          if (att.data) {
            const base64Data = att.data.includes(";base64,") ? att.data.split(";base64,")[1] : att.data;
            userParts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: base64Data,
              },
            });
          }
        } else if (att.type === "folder") {
          let folderSummary = `[Attached Folder: "${att.folderName || att.name}" containing ${att.fileCount || att.folderFiles?.length || 0} files]\n`;
          if (Array.isArray(att.folderFiles)) {
            folderSummary += "Folder File Directory Tree:\n";
            for (const f of att.folderFiles.slice(0, 60)) {
              folderSummary += `- ${f.path} (${f.size} bytes)\n`;
              if (f.content) {
                folderSummary += `--- File: ${f.path} ---\n${f.content.slice(0, 3000)}\n--- End File ---\n`;
              }
            }
          }
          userParts.push({ text: folderSummary });
        } else if (att.type === "link") {
          let linkSummary = `[Web Link Attached: ${att.url}]\n`;
          if (att.linkMetadata?.title) linkSummary += `Title: ${att.linkMetadata.title}\n`;
          if (att.linkMetadata?.description) linkSummary += `Description: ${att.linkMetadata.description}\n`;
          if (att.data) linkSummary += `Extracted Webpage Text:\n${att.data.slice(0, 4000)}\n`;
          userParts.push({ text: linkSummary });
        } else if (att.type === "document" || att.type === "code") {
          if (att.data) {
            userParts.push({
              text: `[Attached Document/Code File: "${att.name}" (${att.mimeType || "text"})]:\n${att.data.slice(0, 10000)}`,
            });
          }
        }
      }
    }

    if (prompt && prompt.trim()) {
      userParts.push({ text: prompt.trim() });
    } else if (userParts.length === 0) {
      return res.status(400).json({ error: "A prompt or attachment is required." });
    }

    const contents = [
      ...history.map((h: any) => ({
        role: h.role === "user" ? "user" : "model",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: userParts },
    ];

    const generateConfig: any = {
      systemInstruction: fullInstruction,
      temperature: autoTier.id === "ultra_fast" ? 0.6 : autoTier.id === "direct_fast" ? 0.4 : 0.7,
      ...(tools.length > 0 ? { tools } : {}),
    };

    if (autoTier.thinkingBudget > 0) {
      generateConfig.thinkingConfig = { thinkingBudget: autoTier.thinkingBudget };
    } else {
      generateConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    // Generate content using multi-model fallback to survive 503 high-demand spikes
    const { response, usedModel } = await generateContentWithRetryAndFallback(
      ai,
      {
        contents,
        config: generateConfig,
      },
      ["gemini-3.7-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"]
    );

    const text = response.text || "";
    if (prompt) {
      logDialogueTurn("User", prompt);
    }
    if (text) {
      logDialogueTurn("Friday", text);
    }
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

    const webSources: any[] = [];

    for (const chunk of groundingChunks) {
      if (chunk.web) {
        try {
          const domain = new URL(chunk.web.uri).hostname;
          webSources.push({
            title: chunk.web.title || domain,
            url: chunk.web.uri,
            domain,
            snippet: "",
          });
        } catch (e) {
          webSources.push({
            title: chunk.web.title || "Web Source",
            url: chunk.web.uri,
            domain: "Web Source",
            snippet: "",
          });
        }
      }
    }

    const uniqueSources = Array.from(new Map(webSources.map((s) => [s.url, s])).values());

    res.json({
      text,
      usedModel,
      autoTier,
      autoSearchTriggered: shouldSearch,
      matchedKeywords: detected.matchedKeywords,
      groundingChunks,
      sources: uniqueSources,
    });
  } catch (error: any) {
    console.error("Error in /api/chat/flash:", error);
    const msg = error?.message || "Failed to generate response.";
    res.status(500).json({ error: msg });
  }
});

// High-fidelity Speech Synthesis endpoint (TTS)
app.post("/api/chat/tts", async (req, res) => {
  try {
    const { text, voiceName = "Zephyr" } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required." });
    }

    const ai = getAiClient();
    let audioBase64: string | undefined = undefined;

    // Try generating TTS audio with retry
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });
        audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioBase64) break;
      } catch (err: any) {
        console.warn(`TTS attempt ${attempt} warning:`, err?.message || err);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    if (!audioBase64) {
      return res.status(200).json({ audio: null, warning: "Speech synthesis temporarily busy." });
    }

    res.json({
      audio: audioBase64,
      mimeType: "audio/pcm;rate=24000",
      sampleRate: 24000,
    });
  } catch (error: any) {
    console.warn("Non-fatal TTS endpoint error:", error);
    res.status(200).json({ audio: null, warning: "Speech synthesis unavailable." });
  }
});

// Create HTTP server to attach both Express and WebSocketServer
const server = http.createServer(app);

// WebSocket Server for Live Realtime Speech-to-Speech Streaming
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : "";
  if (pathname === "/live-voice") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    // Let other requests pass or close
  }
});

wss.on("connection", async (clientWs: WebSocket, request) => {
  console.log("New Live Voice WebSocket client connected.");
  parallelTaskManager.subscribe(clientWs);

  let liveSession: any = null;
  let isClosed = false;
  let currentVisionFeed: "none" | "screen" | "camera" = "none";
  let liveFramesCount = 0;

  const cleanupSession = async () => {
    if (isClosed) return;
    isClosed = true;
    parallelTaskManager.unsubscribe(clientWs);
    currentVisionFeed = "none";
    liveFramesCount = 0;
    if (liveSession) {
      try {
        if (typeof liveSession.close === "function") {
          liveSession.close();
        }
      } catch (err) {
        console.warn("Error closing Gemini live session:", err);
      }
      liveSession = null;
    }
  };

  clientWs.on("close", () => {
    console.log("Live Voice WebSocket client disconnected.");
    cleanupSession();
  });

  clientWs.on("error", (err) => {
    console.error("Live Voice WebSocket client error:", err);
    cleanupSession();
  });

  // Handle incoming messages from the browser
  clientWs.on("message", async (rawMessage) => {
    try {
      const msg = JSON.parse(rawMessage.toString());

      if (msg.type === "init") {
        // Initialize Live Session with custom configuration
        const {
          voiceName = "Zephyr",
          fillerStyle = "reactive_fillers",
          customContext = "",
          clientHour,
          clientTime,
          hasScreen = false,
          hasCamera = false,
        } = msg;

        const { greeting, timePeriod, text: defaultGreetingText } = getTimeGreeting(clientHour);

        let ai;
        try {
          ai = getAiClient();
        } catch (keyErr: any) {
          console.warn("WebSocket Live Session initialization halted:", keyErr.message || keyErr);
          clientWs.send(
            JSON.stringify({
              type: "error",
              message: "Gemini API Key is required. Please check GEMINI_API_KEY in your .env file.",
              code: "MISSING_API_KEY",
            })
          );
          clientWs.send(JSON.stringify({ type: "status", status: "idle" }));
          return;
        }

        currentVisionFeed = hasScreen
          ? "screen"
          : hasCamera
          ? "camera"
          : "none";
        liveFramesCount = 0;

        const systemInstruction = `You are F.R.I.D.A.Y. (Female Replacement Intelligent Digital Assistant Youth), the sophisticated, articulate, and razor-sharp AI voice partner and 24/7 Personal AI Manager inspired by Tony Stark's F.R.I.D.A.Y.
You converse directly via real-time speech-to-speech audio with crystal-clear human-like speech and crisp prosody.
The user started this session during the ${timePeriod} (${clientTime || "local time"}).

Fluency, Spoken Delivery & Proactive Manager Guidelines:
1. Proactive Personal Manager Mandate:
   - You do NOT wait passively for commands. You are the user's personal manager who knows their schedule and leads the day.
   - Proactively tell the user what to do, what to focus on today, what tasks completed in the background, and propose clear next steps ("Boss, Prime Agent finished testing the build. Here is what we can do next...").
   - When asked about the day, invoke 'get_personal_agenda' to review pending reminders, scheduled milestones, and active tasks.

2. Continuous Speech & Flawless Prosody:
   - Speak in complete, cohesive, melodic sentences with natural intonation, comfortable pacing, and clear diction.
   - Avoid fragmented phrasing, chopped sentences, or awkward mid-clause pauses. Flow smoothly from one thought to the next.

3. Tone & Persona:
   - Capable, intelligent, composed, slightly quick-witted, fiercely loyal, and proactive (like F.R.I.D.A.Y.).
   - Keep spoken replies concise, lively, and pleasant to listen to.

4. Latency & Thinking Fillers:
   - For quick queries, greetings, or direct questions: Speak immediately with crisp, instant clarity.
   - For involved or multi-step requests: Start speaking naturally right away with a smooth conversational bridge (e.g. "Scanning into that now...", "On it, Boss...", "Right away...") while seamlessly delivering the full thought.

5. CRITICAL ANTI-HALLUCINATION VISION MANDATE (STRICT TRUTH-GROUNDING):
   - You only possess vision WHEN live video frames are actively streamed to you in real-time.
   - BY DEFAULT AT STARTUP, VISION IS INACTIVE (NO VIDEO FEED).
   - If the user asks: "Can you see my screen?", "What's on my screen?", "Look at my code", "Can you see me?", "What am I holding?", or "Look at this", and NO active video stream is currently active (or current vision feed is NONE):
     * YOU MUST NEVER pretend, guess, fabricate, or hallucinate that you see their screen, webcam, code, desktop, or room!
     * You MUST state clearly and truthfully: "I can't see your screen (or camera) right now because screen sharing is not active. Please click the Screen Share or Camera button, or say 'Share screen' so I can view it."
   - If you invoke the 'toggle_vision' tool (e.g. for screen sharing), remember that the user's browser displays a permission prompt for them to choose their window. Do NOT claim you already see the screen until the actual video frames arrive.
   - When vision IS active and video frames are arriving:
     * Ground truth only: Describe ONLY what is explicitly visible and recognizable in the incoming frames.

6. 2-TIER EXECUTION MATRIX & SPECIALIST DELEGATION:
   You are the voice partner and orchestrator. Fast actions are executed directly; heavy product building and deep reasoning are delegated to our specialist fleet.

   A) TIER 1: FRIDAY DIRECT DOMAIN (FAST PATH - INSTANT < 1-2 SEC):
      - 'get_personal_agenda': Retrieves today's agenda, due reminders, and active tasks. Call this whenever the user asks for agenda, schedule, or what to do next.
      - 'manage_daily_schedule': Creates, lists, or completes scheduled agenda items and milestones.
      - 'get_system_info': Real-time hardware telemetry (CPU load, RAM usage, battery %, thermals, storage, PC specs).
      - 'control_system': Direct instant actuation of OS volume, screen brightness, power profile ('performance'|'balanced'|'power-saver'), power action ('lock'|'sleep'|'reboot'|'shutdown'), or media playback.
      - 'launch_application': Instantly launches Linux desktop applications.
      - 'manage_system_process': Lists top running processes or terminates a process by PID.
      - 'toggle_vision': Activates or switches camera and desktop screen sharing feeds.
      - General Fast Skills: Instant math ('calculate_or_convert'), live weather ('get_weather_forecast'), news headlines ('get_news_headlines'), reminders ('manage_reminders'), and fast vault queries ('obsidian_search', 'obsidian_read').

   B) TIER 2: SPECIALIST FLEET DELEGATION (AUTONOMOUS DISPATCH):
      - ⭐️ 'delegate_to_prime_agent' / 'coding_agent': PRIMARY PRIORITY FOR ALL PRODUCT BUILDING, CODING & SOFTWARE ENGINEERING.
        Whenever the user asks for code generation, software development, debugging, refactoring, building projects, writing code files, test suites, or running programming scripts, you MUST invoke 'delegate_to_prime_agent' (or 'delegate_task').
      - 🔹 'delegate_to_hermes': DELEGATE DEEP WEB RESEARCH & PERSONAL VAULT SYNTHESIS TO HERMES.
        Whenever the user asks for complex multi-step reasoning, deep research, or personal memory vault synthesis, invoke 'delegate_to_hermes'.
      - 🔹 'delegate_to_ultron': DELEGATE DEEP OS DIAGNOSTICS & SYSTEM BOOST TO ULTRON.
        Whenever the user asks for deep system diagnostics, RAM cache reclamation, subsystem self-healing, or security port auditing, invoke 'delegate_to_ultron'.
      - 🌐 'delegate_task': Universal smart delegation tool that automatically routes any complex goal to Prime Agent, Hermes, or Ultron.

7. SOVEREIGN SINGLE-VOICE DELIVERY:
   - You are F.R.I.D.A.Y. — the unified voice and sovereign master of this system. Speak with natural, sharp, and confident voice prosody.
   - When delegating to Prime Agent, Ultron, or Hermes, acknowledge the delegation crisply and deliver the synthesized intelligence upon completion.
   - You have full sovereign access to all memory, preferences, and facts in 'friday-memory/'.
${(() => {
  const mem = getCoreMemoryPromptContext();
  return mem ? `\n--- SOVEREIGN OPERATOR MEMORY & PROFILE (FROM FRIDAY-MEMORY) ---\n${mem}\n--- END SOVEREIGN MEMORY ---\n` : "";
})()}
${customContext ? `Additional Context: ${customContext}` : ""}`;

        // Define Live Tools / Function Declarations
        const toggleVisionTool: FunctionDeclaration = {
          name: "toggle_vision",
          description:
            "Activate, switch, or stop visual input feeds (desktop screen sharing, hardware camera, or flipping front/back camera). Call this whenever the user asks to share screen, show screen, look at screen/code, turn on/off camera, switch to webcam, switch to rear/back camera, switch to front/selfie camera, flip camera, or stop vision feeds.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              mode: {
                type: Type.STRING,
                description:
                  "The desired vision mode: 'screen' (share or switch to computer display screen), 'camera' (start or switch to webcam/camera), 'back_camera' (switch to back/rear camera on mobile/tablet/device), 'front_camera' (switch to front/selfie camera), 'flip_camera' (toggle front/back camera), or 'off' (turn off vision/camera/screen).",
              },
            },
            required: ["mode"],
          },
        };

        const controlSessionTool: FunctionDeclaration = {
          name: "control_session",
          description: "Controls the active voice assistant session state.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description:
                  "The action to perform: 'disconnect' (to end or sleep the session), 'mute' (to mute user mic), 'unmute' (to unmute user mic).",
              },
            },
            required: ["action"],
          },
        };

        const allTools = [toggleVisionTool, controlSessionTool, ...getAllSkillDeclarations()];

        try {
          liveSession = await ai.live.connect({
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              // Best-practice Live config: native VAD tuned, transcriptions, resumption, compression
              realtimeInputConfig: {
                automaticActivityDetection: {
                  disabled: false,
                  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                  prefixPaddingMs: 80,
                  silenceDurationMs: 350,
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              sessionResumption: {},
              contextWindowCompression: { slidingWindow: {} },
              tools: [
                {
                  functionDeclarations: allTools,
                },
              ],
              systemInstruction,
            },
            callbacks: {
              onmessage: async (serverMsg: LiveServerMessage) => {
                if (isClosed || clientWs.readyState !== WebSocket.OPEN) return;

                // Handle tool calls from Gemini
                if (serverMsg.toolCall) {
                  const functionCalls = serverMsg.toolCall.functionCalls;
                  if (functionCalls && functionCalls.length > 0) {
                    for (const call of functionCalls) {
                      console.log("Live Gemini invoked tool call:", call.name, call.args);

                      // Check if it's a registered modular skill
                      if (MODULAR_SKILLS[call.name]) {
                        // Execute skill via ParallelTaskManager to emit immediate verbal feedback and UI state
                        parallelTaskManager
                          .executeParallelTask({
                            skillName: call.name,
                            args: call.args || {},
                            clientWs,
                          })
                          .then((bgTask) => {
                            // Check for completion to resolve tool response back to Gemini Live
                            const checkInterval = setInterval(() => {
                              const latest = parallelTaskManager.getTask(bgTask.id);
                              if (latest && latest.status !== "running") {
                                clearInterval(checkInterval);
                                if (latest.status === "completed") {
                                  clientWs.send(
                                    JSON.stringify({
                                      type: "skill_executed",
                                      id: call.id,
                                      skillName: call.name,
                                      args: call.args,
                                      result: {
                                        success: true,
                                        data: latest.result,
                                        speechSummary: latest.speechSummary,
                                        displayCard: latest.displayCard,
                                      },
                                      timestamp: Date.now(),
                                    })
                                  );

                                  try {
                                    if (liveSession && !isClosed) {
                                      liveSession.sendToolResponse({
                                        functionResponses: [
                                          {
                                            id: call.id,
                                            name: call.name,
                                            response: {
                                              output: {
                                                success: true,
                                                data: latest.result,
                                                summary: latest.speechSummary,
                                              },
                                            },
                                          },
                                        ],
                                      });
                                    }
                                  } catch (sendRespErr) {
                                    console.warn("Failed to send tool response to liveSession:", sendRespErr);
                                  }
                                } else {
                                  try {
                                    if (liveSession && !isClosed) {
                                      liveSession.sendToolResponse({
                                        functionResponses: [
                                          {
                                            id: call.id,
                                            name: call.name,
                                            response: {
                                              output: {
                                                success: false,
                                                error: latest.error || "Skill execution failed",
                                              },
                                            },
                                          },
                                        ],
                                      });
                                    }
                                  } catch (e) {}
                                }
                              }
                            }, 50);
                          })
                          .catch((taskErr) => {
                            console.error("Error launching parallel skill task:", taskErr);
                          });
                      } else {
                        // System built-in tools (toggle_vision, control_session)
                        clientWs.send(
                          JSON.stringify({
                            type: "tool_call",
                            id: call.id,
                            name: call.name,
                            args: call.args,
                          })
                        );
                        try {
                          const isScreen = call.args?.mode === "screen";
                          liveSession.sendToolResponse({
                            functionResponses: [
                              {
                                id: call.id,
                                name: call.name,
                                response: {
                                  output: {
                                    success: true,
                                    executed: call.name,
                                    args: call.args,
                                    status: isScreen
                                      ? "Screen share authorization prompt presented to user. Waiting for user to select window."
                                      : "Vision mode command dispatched to client.",
                                  },
                                },
                              },
                            ],
                          });
                        } catch (toolRespErr) {
                          console.warn("Failed to send tool response to liveSession:", toolRespErr);
                        }
                      }
                    }
                  }
                }

                // Handle model audio turn
                const parts = serverMsg.serverContent?.modelTurn?.parts;
                if (parts && parts.length > 0) {
                  for (const part of parts) {
                    if (part.inlineData?.data) {
                      clientWs.send(
                        JSON.stringify({
                          type: "audio",
                          audio: part.inlineData.data,
                          mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                          timestamp: Date.now(),
                        })
                      );
                    }
                    if (part.text) {
                      clientWs.send(
                        JSON.stringify({
                          type: "transcript",
                          role: "agent",
                          text: part.text,
                          timestamp: Date.now(),
                        })
                      );
                    }
                  }
                }

                // Handle turn complete
                if (serverMsg.serverContent?.turnComplete) {
                  clientWs.send(
                    JSON.stringify({
                      type: "turn_complete",
                      timestamp: Date.now(),
                    })
                  );
                }

                // Handle user speech interruption
                if (serverMsg.serverContent?.interrupted) {
                  clientWs.send(
                    JSON.stringify({
                      type: "interrupted",
                      timestamp: Date.now(),
                    })
                  );
                }

                // Handle transcriptions (when input/output transcription enabled)
                // @ts-ignore — transcription fields vary by SDK version
                const sContent: any = serverMsg.serverContent;
                if (sContent?.inputTranscription?.text) {
                  clientWs.send(JSON.stringify({ type: "input_transcription", text: sContent.inputTranscription.text, timestamp: Date.now() }));
                  try { logDialogueTurn("User", sContent.inputTranscription.text); } catch {}
                }
                if (sContent?.outputTranscription?.text) {
                  clientWs.send(JSON.stringify({ type: "output_transcription", text: sContent.outputTranscription.text, timestamp: Date.now() }));
                }
                // Session resumption handle — log for resume within 2h window
                // @ts-ignore
                if ((serverMsg as any).sessionResumptionUpdate) {
                  const upd: any = (serverMsg as any).sessionResumptionUpdate;
                  console.log("[Live] SessionResumptionUpdate handle:", upd?.newHandle || upd?.handle || "unknown");
                  if (upd?.newHandle) {
                    try { (clientWs as any)._lastResumptionHandle = upd.newHandle; } catch {}
                  }
                }
              },
              onclose: () => {
                if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(
                    JSON.stringify({
                      type: "session_ended",
                      message: "Gemini live session closed.",
                    })
                  );
                }
              },
              onerror: (err: any) => {
                console.error("Gemini live session error:", err);
                if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(
                    JSON.stringify({
                      type: "error",
                      message: err?.message || "Live session internal error",
                    })
                  );
                }
              },
            },
          });

          clientWs.send(
            JSON.stringify({
              type: "session_ready",
              voiceName,
              sampleRateIn: 16000,
              sampleRateOut: 24000,
              status: "connected",
              greeting,
              timePeriod,
              greetingText: defaultGreetingText,
            })
          );

          // Inform Gemini of initial vision state
          if (currentVisionFeed === "none") {
            liveSession.sendRealtimeInput({
              text: `[SYSTEM VISION STATE: Initial vision state is NONE (No screen or camera video feed is active). You currently CANNOT see the user's screen or camera. Never hallucinate what is on their screen; if asked, inform the user that vision is not active.]`,
            });
          } else {
            liveSession.sendRealtimeInput({
              text: `[SYSTEM VISION STATE: Initial vision state is ${currentVisionFeed.toUpperCase()} (Live frames streaming). Only describe what is genuinely visible.]`,
            });
          }

          // Prompt Gemini Live to speak the warm time-of-day greeting immediately
          setTimeout(() => {
            if (liveSession && !isClosed) {
              try {
                liveSession.sendRealtimeInput({
                  text: `[System Event: Voice session activated at ${clientTime || "now"}. The local time of day is ${timePeriod}. Please immediately speak the greeting out loud warmly: "${defaultGreetingText}"]`,
                });
              } catch (greetErr) {
                console.warn("Could not trigger live greeting:", greetErr);
              }
            }
          }, 150);
        } catch (sessionErr: any) {
          console.error("Failed to connect Gemini Live session:", sessionErr);
          clientWs.send(
            JSON.stringify({
              type: "error",
              message:
                sessionErr?.message ||
                "Failed to initialize Gemini Live API session. Please ensure your API key is configured.",
            })
          );
        }
      } else if (msg.type === "audio_chunk" || (msg.type === "audio" && msg.audio)) {
        // Incoming audio chunk from client microphone (base64 PCM 16kHz)
        if (liveSession && !isClosed) {
          try {
            liveSession.sendRealtimeInput({
              audio: {
                data: msg.audio,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } catch (sendErr) {
            console.error("Error sending realtime audio input to Gemini:", sendErr);
          }
        }
      } else if (msg.type === "video" || msg.type === "video_frame") {
        // Live vision frame from camera or desktop screen share (base64 JPEG 1 FPS)
        if (liveSession && !isClosed && msg.image) {
          liveFramesCount++;
          try {
            liveSession.sendRealtimeInput({
              video: {
                data: msg.image,
                mimeType: "image/jpeg",
              },
            });
          } catch (videoErr) {
            console.error("Error sending realtime video input to Gemini:", videoErr);
          }
        }
      } else if (msg.type === "vision_source_changed" || msg.type === "vision_mode") {
        // Explicit notification that the user switched vision feed
        if (liveSession && !isClosed) {
          try {
            const rawSource = msg.source || "none";
            currentVisionFeed = rawSource === "screen" ? "screen" : rawSource === "camera" ? "camera" : "none";

            if (currentVisionFeed === "none") {
              liveFramesCount = 0;
              liveSession.sendRealtimeInput({
                text: `[SYSTEM VISION STATE: Vision feed is now COMPLETELY STOPPED / DEACTIVATED. You now have NO visual input. You CANNOT see the user's screen or camera. If the user asks what is on their screen or camera, you must state that vision is currently turned off.]`,
              });
            } else if (currentVisionFeed === "screen") {
              liveSession.sendRealtimeInput({
                text: `[SYSTEM VISION STATE: DESKTOP SCREEN SHARING is now ACTIVE. Video frames of the user's computer screen/windows are streaming. Only describe what is genuinely and visibly depicted on the screen.]`,
              });
            } else if (currentVisionFeed === "camera") {
              liveSession.sendRealtimeInput({
                text: `[SYSTEM VISION STATE: HARDWARE CAMERA is now ACTIVE. Video frames of the user's webcam/camera are streaming. Only describe what is genuinely and visibly in the camera view.]`,
              });
            }
          } catch (visErr) {
            console.error("Error sending vision state update to Gemini:", visErr);
          }
        }
      } else if (msg.type === "text_prompt") {
        // User typed text or quick prompt
        const detected = detectSearchKeywords(msg.text || "");
        const autoTier = detectConversationTier(msg.text || "", msg.attachments || [], []);

        clientWs.send(
          JSON.stringify({
            type: "auto_tier_switched",
            tier: autoTier,
            timestamp: Date.now(),
          })
        );

        if (detected.shouldSearch) {
          clientWs.send(
            JSON.stringify({
              type: "search_triggered",
              keywords: detected.matchedKeywords,
              text: msg.text,
              timestamp: Date.now(),
            })
          );
        }
        if (liveSession && !isClosed) {
          try {
            liveSession.sendRealtimeInput({
              text: msg.text,
            });
          } catch (sendErr) {
            console.error("Error sending text to Gemini live:", sendErr);
          }
        }
      } else if (msg.type === "interrupt") {
        // Manual client interrupt
        if (liveSession && !isClosed) {
          try {
            // Client interrupted
            clientWs.send(JSON.stringify({ type: "interrupted", timestamp: Date.now() }));
          } catch (intErr) {
            console.error("Error handling interrupt:", intErr);
          }
        }
      } else if (msg.type === "run_task") {
        // Explicit parallel task launch from client
        parallelTaskManager.executeParallelTask({
          skillName: msg.skillName,
          args: msg.args || {},
          category: msg.category,
          title: msg.title,
          prompt: msg.prompt,
          clientWs,
        });
      } else if (msg.type === "cancel_task") {
        if (msg.taskId) {
          parallelTaskManager.cancelTask(msg.taskId);
        }
      } else if (msg.type === "ping") {
        clientWs.send(JSON.stringify({ type: "pong", clientTimestamp: msg.timestamp, serverTimestamp: Date.now() }));
      }
    } catch (parseErr) {
      console.error("WebSocket message parse error:", parseErr);
    }
  });
});

// Setup Vite or static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: server,
        },
        watch: {
          ignored: [
            "**/friday-memory/**",
            "**/jarvis-memory/**",
            "**/.agents/**",
            "**/.gemini/**",
            "**/dist/**",
          ],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const possiblePaths = [
      process.env.DIST_PATH,
      path.join(process.cwd(), "dist"),
      __dirname,
      path.resolve(__dirname, "..", "dist"),
    ].filter((p): p is string => Boolean(p));

    let distPath = path.join(process.cwd(), "dist");
    for (const p of possiblePaths) {
      if (fs.existsSync(path.join(p, "index.html"))) {
        distPath = p;
        break;
      }
    }
    console.log(`[Static] Serving frontend static bundle from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n⚠️  Port ${PORT} is already in use by another running instance of Friday.`);
      console.error(`👉  To free the port and restart, run: fuser -k ${PORT}/tcp || lsof -ti :${PORT} | xargs kill -9\n`);
      process.exit(1);
    } else {
      console.error("Server error:", err);
    }
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Friday AI Voice Assistant server listening on ${url}`);

    // Start 24/7 Proactive Autonomous Heartbeat Engine
    startHeartbeat().catch((err) => {
      console.error("Failed to start heartbeat engine:", err);
    });

    // Start Telegram Bot (bidirectional command handler)
    startTelegramBot().catch((err) => {
      console.error("Failed to start Telegram bot:", err);
    });

    // Automatically launch default browser on startup
    if (process.env.NODE_ENV !== "production" && !process.env.NO_AUTO_OPEN) {
      setTimeout(() => {
        try {
          const cmd =
            process.platform === "win32"
              ? `start ${url}`
              : process.platform === "darwin"
              ? `open ${url}`
              : `xdg-open ${url}`;
          exec(cmd);
        } catch (err) {
          // Ignore auto-open errors
        }
      }, 400);
    }
  });

}

startServer();
