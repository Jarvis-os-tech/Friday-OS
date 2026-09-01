/* ============================================================
   speech.js — Speech I/O wrappers + Gemini PCM Player
   STT: webkitSpeechRecognition (Chrome/Edge) with fallback.
   TTS: Gemini PCM Audio playback + Browser SpeechSynthesis.
   ============================================================ */
"use strict";

const Speech = (() => {
  let recog = null;
  let active = false;
  let audioCtx = null;
  let currentPcmSource = null;

  const sttSupported = () =>
    "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
  const ttsSupported = () => "speechSynthesis" in window;

  function getAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC({ sampleRate: 24000 });
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  /* ---------------- STT ---------------- */
  function startListening({ onInterim, onFinal, onError, onEnd }) {
    if (!sttSupported()) {
      if (onError) onError("unsupported");
      return false;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = navigator.language || "en-US";

    active = true;
    recog.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += txt; else interim += txt;
      }
      if (interim && onInterim) onInterim(interim);
      if (final && onFinal) onFinal(final.trim());
    };
    recog.onerror = (e) => { active = false; if (onError) onError(e.error); };
    recog.onend = () => {
      const wasActive = active;
      active = false;
      if (wasActive && onEnd) onEnd();
    };
    try { recog.start(); return true; }
    catch { active = false; return false; }
  }

  function stopListening() {
    active = false;
    if (recog) { try { recog.stop(); } catch {} }
  }

  /* ---------------- PCM Playback for Gemini Audio ---------------- */
  function playPcmBase64(base64Data, sampleRate = 24000, { onStart, onDone, onBoundary } = {}) {
    shutUp();
    try {
      const ctx = getAudioContext();
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert 16-bit PCM to Float32
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32Array.length, sampleRate);
      buffer.copyToChannel(float32Array, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      currentPcmSource = source;

      if (onStart) onStart();

      // Interval for audio boundary pulsation
      const iv = setInterval(() => {
        if (onBoundary) onBoundary(0.4 + Math.random() * 0.4);
      }, 120);

      source.onended = () => {
        clearInterval(iv);
        currentPcmSource = null;
        if (onDone) onDone();
      };

      source.start();
      return () => {
        clearInterval(iv);
        try { source.stop(); } catch {}
        currentPcmSource = null;
      };
    } catch (err) {
      console.warn("PCM play failed, falling back to speech synthesis:", err);
      return null;
    }
  }

  /* ---------------- Browser TTS fallback ---------------- */
  function speak(text, { onStart, onBoundary, onDone } = {}) {
    shutUp();
    if (!ttsSupported()) {
      if (onStart) onStart();
      const words = text.split(/\s+/);
      let i = 0;
      const iv = setInterval(() => {
        i++;
        if (onBoundary) onBoundary(i / words.length);
        if (i >= words.length) { clearInterval(iv); if (onDone) onDone(); }
      }, 240);
      return () => { clearInterval(iv); if (onDone) onDone(); };
    }

    const cleanText = text.replace(/[*_#`~\[\]\(\)]/g, " ");
    const u = new SpeechSynthesisUtterance(cleanText);
    u.rate = 1.02;
    u.pitch = 0.95;
    const voices = speechSynthesis.getVoices();
    const preferred =
      voices.find(v => /en.*(male|daniel|david|google uk english male|george)/i.test(v.name + v.lang)) ||
      voices.find(v => /en-GB/i.test(v.lang)) ||
      voices.find(v => /^en/i.test(v.lang));
    if (preferred) u.voice = preferred;

    u.onstart = () => onStart && onStart();
    u.onboundary = () => onBoundary && onBoundary();
    u.onend = () => onDone && onDone();
    u.onerror = () => onDone && onDone();

    speechSynthesis.speak(u);
    return () => { speechSynthesis.cancel(); };
  }

  function shutUp() {
    if (currentPcmSource) {
      try { currentPcmSource.stop(); } catch {}
      currentPcmSource = null;
    }
    if (ttsSupported()) speechSynthesis.cancel();
  }

  return {
    startListening,
    stopListening,
    speak,
    playPcmBase64,
    shutUp,
    sttSupported,
    ttsSupported,
    getAudioContext,
  };
})();
