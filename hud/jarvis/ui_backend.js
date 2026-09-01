/* hud/jarvis/ui_backend.js — Real Gemini AI Backend integration (localhost:3000)
   Connects the HUD interface directly to Gemini 3.7 Flash, Gemini Live, Greeting, and TTS APIs.
*/
const JarvisBackend = (() => {
  const isPort3000 = window.location.port === "3000";
  const defaultBase = isPort3000 ? window.location.origin : "http://localhost:3000";
  const BASE = localStorage.getItem("jarvis_base") || defaultBase;
  const WS_URL = BASE.replace(/^http/, "ws") + "/live-voice";

  function log(...args) {
    console.debug("[jarvis-backend]", ...args);
  }

  // Health check
  async function checkHealth() {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      const data = await r.json();
      return data.status === "ok" && data.hasApiKey;
    } catch (e) {
      return false;
    }
  }

  // Time-aware AI Greeting
  async function getGreeting(voiceName = "Zephyr") {
    try {
      const clientHour = new Date().getHours();
      const r = await fetch(`${BASE}/api/chat/greet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientHour, voiceName }),
      });
      if (r.ok) {
        return await r.json();
      }
    } catch (e) {
      log("Greeting error:", e);
    }
    return null;
  }

  // Gemini 3.7 Flash Reasoning + Grounding
  async function chatFlash(prompt, history = [], enableSearch = undefined, systemInstruction = undefined) {
    try {
      const r = await fetch(`${BASE}/api/chat/flash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          history,
          enableSearch,
          systemInstruction,
        }),
      });
      if (r.ok) {
        return await r.json();
      } else {
        const err = await r.json().catch(() => ({ error: "Server response error" }));
        throw new Error(err.error || "Flash response failed");
      }
    } catch (e) {
      log("chatFlash error:", e);
      throw e;
    }
  }

  // High-Fidelity TTS
  async function generateTTS(text, voiceName = "Zephyr") {
    try {
      const r = await fetch(`${BASE}/api/chat/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceName }),
      });
      if (r.ok) {
        return await r.json();
      }
    } catch (e) {
      log("TTS error:", e);
    }
    return null;
  }

  // Available Voices
  async function getVoices() {
    try {
      const r = await fetch(`${BASE}/api/voices`);
      if (r.ok) {
        return await r.json();
      }
    } catch (e) {
      log("getVoices error:", e);
    }
    return { voices: [] };
  }

  return {
    BASE,
    WS_URL,
    checkHealth,
    getGreeting,
    chatFlash,
    generateTTS,
    getVoices,
  };
})();

window.JarvisBackend = JarvisBackend;
