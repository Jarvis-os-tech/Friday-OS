/* ============================================================
   app.js — J.A.R.V.I.S / F.R.I.D.A.Y Voice Interface State Machine
   Fully wired to live Gemini AI Backend on localhost:3000
   idle → listening → thinking → speaking (+ error)
   ============================================================ */
"use strict";

const App = (() => {
  const S = Object.freeze({
    IDLE: "idle",
    LISTENING: "listening",
    THINKING: "thinking",
    SPEAKING: "speaking",
    ERROR: "error",
  });

  let state = S.IDLE;
  let orb, stateName, stateSub, liveCaptionEl, liveSlot;
  let rafId = null;
  let cancelSpeak = null;
  let micGranted = false;
  let conversationHistory = [];
  let isBackendOnline = false;

  /* ---------------- boot ---------------- */
  function init() {
    orb = document.getElementById("orb");
    stateName = document.getElementById("state-name");
    stateSub = document.getElementById("state-sub");
    liveCaptionEl = document.getElementById("live-caption");
    liveSlot = document.getElementById("live-slot");

    Halo.mount(document.getElementById("halo"));
    Panels.init();
    wireControls();
    checkBackendHealth();
    setInterval(checkBackendHealth, 8000);

    Boot.run(() => {
      greet();
    });
  }

  async function checkBackendHealth() {
    const netEl = document.getElementById("net-lat");
    if (!window.JarvisBackend) return;
    isBackendOnline = await window.JarvisBackend.checkHealth();
    if (netEl) {
      netEl.textContent = isBackendOnline ? "AI ONLINE" : "AI OFFLINE";
      netEl.style.color = isBackendOnline ? "var(--green)" : "var(--red)";
    }
  }

  async function greet() {
    setState(S.SPEAKING);
    let greetingText = "Systems online. All diagnostics nominal. I am listening whenever you need me.";
    let greetingAudio = null;

    if (window.JarvisBackend) {
      try {
        const greetData = await window.JarvisBackend.getGreeting();
        if (greetData && greetData.text) {
          greetingText = greetData.text;
          greetingAudio = greetData.audio;
        }
      } catch (e) {
        console.debug("Greeting error:", e);
      }
    }

    showCaption("JARVIS", greetingText);
    addMsg("jarvis", greetingText);

    const muted = document.getElementById("btn-mute")?.getAttribute("aria-pressed") === "true";
    if (muted) {
      toIdle();
      return;
    }

    if (greetingAudio) {
      cancelSpeak = Speech.playPcmBase64(greetingAudio, 24000, {
        onStart: () => { Halo.start(); startSampleLoop(); },
        onBoundary: (lvl) => Halo.setTarget(lvl || 0.45),
        onDone: () => toIdle(),
      });
    }

    if (!cancelSpeak) {
      cancelSpeak = Speech.speak(greetingText, {
        onStart: () => { Halo.start(); startSampleLoop(); },
        onBoundary: () => Halo.setTarget(0.45 + Math.random() * 0.3),
        onDone: () => toIdle(),
      });
    }

    setTimeout(() => {
      if (state === S.SPEAKING && !Speech.ttsSupported() && !greetingAudio) toIdle();
    }, 6000);
  }

  /* ---------------- state machine ---------------- */
  function setState(next) {
    state = next;
    if (orb) orb.dataset.state = next;
    centerColToggle(next);

    switch (next) {
      case S.IDLE:
        stateName.textContent = "STANDBY";
        stateSub.textContent = "Tap the core or press Space to speak";
        Halo.stop();
        Halo.setTarget(0);
        stopSampleLoop();
        AudioEngine.stopMic();
        break;
      case S.LISTENING:
        stateName.textContent = "LISTENING";
        stateSub.textContent = "Go ahead — I am all ears";
        break;
      case S.THINKING:
        stateName.textContent = "PROCESSING";
        stateSub.textContent = "Gemini 3.7 Flash Reasoning…";
        Halo.setTarget(0);
        break;
      case S.SPEAKING:
        stateName.textContent = "RESPONDING";
        stateSub.textContent = "Press Esc to interrupt";
        break;
      case S.ERROR:
        stateName.textContent = "MIC OFFLINE";
        stateSub.textContent = "Type instead — press Ctrl+K";
        break;
    }

    const sr = document.getElementById("sr-state");
    if (sr) sr.textContent = `Jarvis state: ${next}`;
  }

  function centerColToggle(next) {
    const col = document.querySelector(".center-col");
    if (col) col.toggleAttribute("data-thinking", next === S.THINKING);
  }

  async function beginListening() {
    if (state === S.LISTENING) return;
    interruptSpeech();

    clearCaption();
    setLiveSlot("…");

    const ok = await AudioEngine.startMic();
    micGranted = ok || micGranted;

    setState(S.LISTENING);
    Halo.start();

    const sttOk = Speech.startListening({
      onInterim: (txt) => setLiveSlot(txt),
      onFinal: (txt) => {
        setLiveSlot("");
        handleUtterance(txt);
      },
      onError: (err) => {
        if (err === "not-allowed" || err === "service-not-allowed") {
          setState(S.ERROR);
          setTimeout(() => { if (state === S.ERROR) toIdle(); }, 4000);
        } else if (err === "no-speech") {
          toIdle();
        } else if (err === "unsupported") {
          simulateUtterance();
        }
      },
      onEnd: () => {
        if (state === S.LISTENING) toIdle();
        AudioEngine.stopMic();
      },
    });

    startSampleLoop();
    if (!sttOk) simulateUtterance();
  }

  function simulateUtterance() {
    setLiveSlot("Voice input simulated — try Ctrl+K for real text input");
    setTimeout(() => {
      setLiveSlot("");
      handleUtterance("Give me a tactical status report");
    }, 1600);
  }

  function startSampleLoop() {
    stopSampleLoop();
    const tick = () => {
      const lvl = AudioEngine.sample();
      Halo.setTarget(state === S.LISTENING || state === S.SPEAKING ? Math.min(1, lvl * 1.4) : 0);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopSampleLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  async function handleUtterance(text) {
    if (!text || !text.trim()) {
      toIdle();
      return;
    }
    const cleanPrompt = text.trim();
    addMsg("user", cleanPrompt);
    setState(S.THINKING);

    await respond(cleanPrompt);
  }

  async function respond(promptText) {
    let replyText = "";
    let pcmAudio = null;
    let sources = [];
    let autoTier = null;

    try {
      if (window.JarvisBackend) {
        const historyForApi = conversationHistory.slice(-8);
        const data = await window.JarvisBackend.chatFlash(promptText, historyForApi);

        if (data && data.text) {
          replyText = data.text;
          sources = data.sources || [];
          autoTier = data.autoTier;

          // Record conversation history
          conversationHistory.push({ role: "user", text: promptText });
          conversationHistory.push({ role: "model", text: replyText });

          // Attempt high-fidelity TTS
          const muted = document.getElementById("btn-mute")?.getAttribute("aria-pressed") === "true";
          if (!muted) {
            try {
              const ttsData = await window.JarvisBackend.generateTTS(replyText);
              if (ttsData && ttsData.audio) {
                pcmAudio = ttsData.audio;
              }
            } catch (ttsErr) {
              console.warn("TTS fetch fallback:", ttsErr);
            }
          }
        }
      }
    } catch (err) {
      console.error("Gemini Flash API call failed:", err);
      replyText = "I encountered an issue reaching the Gemini intelligence core. Please check your API key and connection.";
    }

    if (!replyText) {
      replyText = "Systems operational. No response received from intelligence core.";
    }

    addMsg("jarvis", replyText, sources);
    setState(S.SPEAKING);
    showCaption("JARVIS", replyText);

    if (autoTier && stateSub) {
      stateSub.textContent = `${autoTier.badge || "Gemini Flash"} · ${autoTier.name || "Live"}`;
    }

    const muted = document.getElementById("btn-mute")?.getAttribute("aria-pressed") === "true";
    if (muted) {
      toIdle();
      return;
    }

    if (pcmAudio) {
      cancelSpeak = Speech.playPcmBase64(pcmAudio, 24000, {
        onStart: () => { Halo.start(); startSampleLoop(); },
        onBoundary: (lvl) => Halo.setTarget(lvl || 0.45),
        onDone: () => toIdle(),
      });
    }

    if (!cancelSpeak) {
      cancelSpeak = Speech.speak(replyText, {
        onStart: () => { Halo.start(); startSampleLoop(); },
        onBoundary: () => Halo.setTarget(0.35 + Math.random() * 0.45),
        onDone: () => toIdle(),
      });
    }
  }

  function toIdle() {
    interruptSpeech(false);
    clearCaption();
    stopSampleLoop();
    Halo.stop();
    setState(S.IDLE);
  }

  function interruptSpeech(clearCap = true) {
    Speech.shutUp();
    if (cancelSpeak) {
      cancelSpeak();
      cancelSpeak = null;
    }
    Speech.stopListening();
    if (clearCap) clearCaption();
  }

  /* ---------------- transcript UI ---------------- */
  function addMsg(who, text, sources = []) {
    const log = document.getElementById("log-scroll");
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;

    const el = document.createElement("div");
    el.className = `msg ${who}`;
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    let sourceHtml = "";
    if (Array.isArray(sources) && sources.length > 0) {
      sourceHtml = `<div class="sources" style="margin-top:6px;font-size:11px;opacity:0.75;">
        <b>Sources:</b> ${sources.map(s => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--cyan);text-decoration:underline;margin-right:8px;">${escapeHtml(s.title || s.domain || "Link")}</a>`).join("")}
      </div>`;
    }

    el.innerHTML = `<span class="who">${who === "user" ? "YOU" : "JARVIS"}</span>${escapeHtml(text)}${sourceHtml}<span class="t">${t}</span>`;
    log.appendChild(el);

    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  function setLiveSlot(txt) {
    if (!liveSlot) return;
    liveSlot.textContent = txt || "";
    liveSlot.style.fontStyle = txt ? "italic" : "normal";
  }

  function clearCaption() {
    if (!liveCaptionEl) return;
    liveCaptionEl.style.opacity = "0";
    liveCaptionEl.innerHTML = "";
  }

  function showCaption(who, text) {
    if (!liveCaptionEl) return;
    liveCaptionEl.innerHTML = `<span class="who">${who}</span>${escapeHtml(text)}`;
    liveCaptionEl.style.transition = "opacity 200ms ease";
    liveCaptionEl.style.opacity = "1";
  }

  function escapeHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ---------------- controls ---------------- */
  function wireControls() {
    if (orb) {
      orb.addEventListener("click", () => {
        if (state === S.IDLE || state === S.ERROR) beginListening();
        else toIdle();
      });
    }

    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      const paletteOpen = document.getElementById("palette-backdrop")?.classList.contains("open");
      if (paletteOpen) {
        if (e.key === "Escape") closePalette();
        return;
      }
      if (e.code === "Space" && !e.repeat && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        if (state === S.IDLE || state === S.ERROR) beginListening();
      }
      if (e.key === "Escape") {
        if (state === S.SPEAKING || state === S.LISTENING || state === S.THINKING) toIdle();
      }
    });

    document.getElementById("btn-cc")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
      if (liveCaptionEl) liveCaptionEl.style.display = pressed ? "none" : "block";
    });

    document.getElementById("btn-palette")?.addEventListener("click", openPalette);
    document.getElementById("btn-mute")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const muted = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(muted));
      btn.title = muted ? "Unmute voice" : "Mute voice";
      if (muted) Speech.shutUp();
    });

    document.getElementById("palette-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitPalette();
    });

    document.getElementById("palette-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "palette-backdrop") closePalette();
    });
  }

  function openPalette() {
    const bd = document.getElementById("palette-backdrop");
    if (!bd) return;
    bd.classList.add("open");
    const input = document.getElementById("palette-input");
    if (input) {
      input.value = "";
      input.focus();
    }
  }

  function closePalette() {
    const bd = document.getElementById("palette-backdrop");
    if (bd) bd.classList.remove("open");
  }

  function submitPalette() {
    const input = document.getElementById("palette-input");
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;
    closePalette();
    handleUtterance(v);
  }

  return { init };
})();

window.addEventListener("DOMContentLoaded", App.init);
