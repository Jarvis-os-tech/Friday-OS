/**
 * Instantaneous Verbal & Acoustic Feedback Engine
 * Delivers immediate spoken acknowledgments (< 100ms) and acoustic telemetry chimes
 * as soon as a user request or parallel background task is initiated.
 */

const ACKNOWLEDGMENT_VARIATIONS: Record<string, string[]> = {
  prime_agent: [
    "Dispatching coding task to Prime Agent.",
    "Engaging Prime Agent for software engineering and execution.",
    "Handing off development task to Prime Agent.",
  ],
  ultron: [
    "Engaging Ultron for deep OS diagnostics and performance optimization.",
    "Initiating Ultron system monitoring and awareness sweep.",
    "Ultron is analyzing system telemetry and hardware governors.",
  ],
  system: [
    "Executing system control command.",
    "Adjusting system settings now.",
  ],
  hermes: [
    "Routing task to Hermes personal intelligence.",
    "Delegating complex workflow to Hermes.",
  ],
  openclaw: [
    "Dispatching task to OpenClaw autonomous gateway.",
    "Routing request to OpenClaw multimodal agent.",
    "Connecting to OpenClaw workspace.",
  ],
  weather: [
    "Checking live weather conditions and forecast now.",
    "Scanning meteorological data for you.",
    "Pulling the latest temperature and forecast.",
  ],
  news: [
    "Fetching the latest breaking headlines now.",
    "Scanning live news feeds in the background.",
    "Pulling top stories for you.",
  ],
  research: [
    "Investigating live web intelligence now.",
    "Grounding research with verified sources.",
    "Scanning web knowledge in parallel.",
  ],
  obsidian: [
    "Searching your Obsidian vault in the background.",
    "Querying your notes now.",
    "Accessing your knowledge vault.",
  ],
  productivity: [
    "Updating your scheduled reminders.",
    "Processing your reminder in the background.",
  ],
  calculation: [
    "Computing calculation in parallel.",
    "Evaluating that now.",
  ],
  general: [
    "Processing your request...",
    "Working on that now, Boss.",
    "Scanning into that now...",
    "On it right away...",
    "Right away, Boss.",
  ],
};

export function getContextualVerbalPhrase(intentOrSkill?: string, target?: string): string {
  if (!intentOrSkill) {
    const list = ACKNOWLEDGMENT_VARIATIONS.general;
    return list[Math.floor(Math.random() * list.length)];
  }

  const lower = intentOrSkill.toLowerCase();
  let category = "general";

  if (lower.includes("prime") || lower.includes("coding") || lower.includes("program") || lower.includes("script")) {
    category = "prime_agent";
  } else if (lower.includes("ultron") || lower.includes("boost") || lower.includes("diagnostic") || lower.includes("heal")) {
    category = "ultron";
  } else if (lower.includes("system") || lower.includes("volume") || lower.includes("brightness") || lower.includes("power")) {
    category = "system";
  } else if (lower.includes("weather") || lower.includes("forecast") || lower.includes("temp")) {
    category = "weather";
  } else if (lower.includes("news") || lower.includes("headline") || lower.includes("article")) {
    category = "news";
  } else if (lower.includes("search") || lower.includes("research") || lower.includes("find out")) {
    category = "research";
  } else if (lower.includes("obsidian") || lower.includes("note") || lower.includes("vault")) {
    category = "obsidian";
  } else if (lower.includes("hermes") || lower.includes("memory")) {
    category = "hermes";
  } else if (lower.includes("openclaw") || lower.includes("claw")) {
    category = "openclaw";
  } else if (lower.includes("reminder") || lower.includes("alarm") || lower.includes("schedule")) {
    category = "productivity";
  } else if (lower.includes("calc") || lower.includes("math") || lower.includes("solve")) {
    category = "calculation";
  }

  if (target && category === "weather") {
    return `Checking live weather for ${target} now.`;
  }
  if (target && category === "news") {
    return `Fetching top ${target} headlines now.`;
  }
  if (target && category === "obsidian") {
    return `Looking up "${target}" in your Obsidian vault.`;
  }

  const pool = ACKNOWLEDGMENT_VARIATIONS[category] || ACKNOWLEDGMENT_VARIATIONS.general;
  return pool[Math.floor(Math.random() * pool.length)];
}

export class VerbalFeedbackEngine {
  private static isMuted: boolean = false;

  public static setMuted(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Spoken audio is exclusively handled by Friday's native Live voice stream.
   * Browser SpeechSynthesis is disabled to prevent overlapping robotic voices.
   */
  public static speakImmediate(_phrase: string, _options?: { rate?: number; pitch?: number; volume?: number }) {
    // No-op: Only Friday speaks via Gemini Live audio stream
    return;
  }


  /**
   * Play low-latency acoustic telemetry feedback chime (Web Audio API)
   */
  public static playChime(type: "task_started" | "task_completed" | "task_alert") {
    if (this.isMuted) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === "task_started") {
        // Subtle cyber initiation blip
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.09);
      } else if (type === "task_completed") {
        // High-tech harmonic confirmation chime
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.type = "sine";
        osc2.type = "triangle";

        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc1.frequency.setValueAtTime(659.25, now + 0.06); // E5
        osc1.frequency.setValueAtTime(783.99, now + 0.12); // G5

        osc2.frequency.setValueAtTime(1046.5, now + 0.12); // C6

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc1.start(now);
        osc2.start(now + 0.12);
        osc1.stop(now + 0.35);
        osc2.stop(now + 0.35);
      }
    } catch (e) {
      // Ignore audio context errors
    }
  }
}
