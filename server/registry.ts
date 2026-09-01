/**
 * Friday-OS — Master Agent, Skills, and Tools Registry
 *
 * Provides typed access to all available agents, sub-agents, modular skills,
 * and native tool actuators in the Friday-OS ecosystem.
 *
 * Backed by `agents.registry.json`.
 */

import fs from "fs";
import path from "path";

// ── Types ───────────────────────────────────────────────────────

export interface AgentRegistryEntry {
  id: string;
  name: string;
  role: string;
  description: string;
  platform: "gemini-live" | "hermes" | "prime-agent" | "ultron" | "rust-memory-engine" | "openclaw" | "mcp";
  profile?: string;
  thread?: string;
  vaultDirectory?: string;
  status: "online" | "ready" | "offline" | "disabled";
  capabilities: string[];
}

export interface SkillRegistryEntry {
  name: string;
  displayName: string;
  category: "Weather" | "News" | "Productivity" | "Utility" | "System";
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    enum?: string[];
  }>;
  executionMode: "sync" | "async-parallel";
  source: string;
}

export interface ToolRegistryEntry {
  binary?: string;
  description: string;
  category?: string;
  status?: string;
  port?: number;
  socketPath?: string;
  source?: string;
}

export interface MasterRegistry {
  version: string;
  name: string;
  description: string;
  updatedAt: string;
  agents: Record<string, AgentRegistryEntry>;
  skills: Record<string, SkillRegistryEntry>;
  tools: {
    cpp_workers: {
      category: string;
      binDirectory: string;
      totalWorkers: number;
      items: Record<string, ToolRegistryEntry>;
    };
    audio_gateway: ToolRegistryEntry;
    memory_engine: ToolRegistryEntry;
    telegram_notifier: ToolRegistryEntry;
    heartbeat_engine: ToolRegistryEntry;
    capability_forge: ToolRegistryEntry;
    [key: string]: any;
  };
}

// ── Singleton Loader ────────────────────────────────────────────

let cachedRegistry: MasterRegistry | null = null;

function loadRegistry(): MasterRegistry {
  if (cachedRegistry) return cachedRegistry;

  const registryPath = path.resolve(process.cwd(), "agents.registry.json");
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Master registry file not found at: ${registryPath}`);
  }

  const raw = fs.readFileSync(registryPath, "utf-8");
  cachedRegistry = JSON.parse(raw) as MasterRegistry;
  return cachedRegistry;
}

// ── Query APIs ──────────────────────────────────────────────────

/**
 * Get the full master registry.
 */
export function getMasterRegistry(): MasterRegistry {
  return loadRegistry();
}

/**
 * Get all registered agents as a list.
 */
export function getRegisteredAgents(): AgentRegistryEntry[] {
  const reg = loadRegistry();
  return Object.values(reg.agents);
}

/**
 * Get a specific agent by its ID (e.g. 'prime-agent', 'friday-prime', 'hermes', 'ultron').
 */
export function getAgentById(id: string): AgentRegistryEntry | undefined {
  const reg = loadRegistry();
  return reg.agents[id];
}

/**
 * Get all registered skills as a list.
 */
export function getRegisteredSkills(): SkillRegistryEntry[] {
  const reg = loadRegistry();
  return Object.values(reg.skills);
}

/**
 * Get a specific skill by its name (e.g. 'get_weather_forecast', 'manage_reminders').
 */
export function getSkillByName(name: string): SkillRegistryEntry | undefined {
  const reg = loadRegistry();
  return reg.skills[name];
}

/**
 * Get all native C++ workers and actuators.
 */
export function getRegisteredTools() {
  const reg = loadRegistry();
  return {
    cppWorkers: reg.tools.cpp_workers.items,
    audioGateway: reg.tools.audio_gateway,
    memoryEngine: reg.tools.memory_engine,
    telegramNotifier: reg.tools.telegram_notifier,
    heartbeatEngine: reg.tools.heartbeat_engine,
    capabilityForge: reg.tools.capability_forge,
  };
}

/**
 * Summary metrics for quick system telemetry.
 */
export function getRegistryStats() {
  const reg = loadRegistry();
  return {
    totalAgents: Object.keys(reg.agents).length,
    totalSkills: Object.keys(reg.skills).length,
    totalCppWorkers: Object.keys(reg.tools.cpp_workers.items).length,
    version: reg.version,
    updatedAt: reg.updatedAt,
  };
}

/**
 * Formats a condensed, markdown representation of all available Agents, Skills,
 * and Tools for injection into Friday's LLM system prompt context.
 *
 * This allows Friday to always be self-aware of what tools and sub-agents it can invoke.
 */
export function generateSystemPromptRegistry(): string {
  const reg = loadRegistry();

  const agentLines = Object.values(reg.agents)
    .map((a) => `- **${a.name}** (\`${a.id}\`): ${a.role} [${a.capabilities.join(", ")}]`)
    .join("\n");

  const skillLines = Object.values(reg.skills)
    .map((s) => `- \`${s.name}\` (${s.category}): ${s.description}`)
    .join("\n");

  const cppWorkerCount = Object.keys(reg.tools.cpp_workers.items).length;

  return `
### 🛠️ Friday-OS Capabilities & Sub-Agent Registry
**Delegatable Sub-Agents & Departments:**
${agentLines}

**Available Modular Skills:**
${skillLines}

**Hardware & System Actuators:**
- ${cppWorkerCount} compiled C++ native workers in \`workers_cpp/bin/\` (telemetry, processes, thermals, storage, wifi, desktop automation).
- Rust Audio Gateway (\`/tmp/jarvis_audio.sock\`) for standalone mic/speaker streaming.
- Rust Memory Engine (port 50051) with SQLite WAL & FTS5 Knowledge Graph.
- Capability Forge (\`bwrap\` sandbox) for dynamically synthesizing custom tools.
- Proactive Telegram Notifier & 24/7 Heartbeat.
`.trim();
}
