/* ============================================================
   audio.js — Microphone capture + analysis
   getUserMedia → AnalyserNode → log-spaced bands.
   Falls back to a synthetic envelope when mic is denied so the
   UI remains fully demonstrable without permissions.
   ============================================================ */
"use strict";

const AudioEngine = (() => {
  let ctx = null;
  let analyser = null;
  let freqData = null;
  let mediaStream = null;
  let simTimer = null;
  let simLevel = 0;

  const BANDS = 48;                 // log-spaced bands for the halo
  let bandEnergy = new Float32Array(BANDS);

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
  }

  /* ---- real microphone ---- */
  async function startMic() {
    ensureCtx();
    if (ctx.state === "suspended") await ctx.resume();
    if (mediaStream) return true;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const src = ctx.createMediaStreamSource(mediaStream);
      // NOTE: deliberately NOT connected to destination (no feedback loop)
      src.connect(analyser);
      stopSim();
      return true;
    } catch (err) {
      console.warn("[audio] mic unavailable, using simulation:", err.name);
      startSim();
      return false;
    }
  }

  function stopMic() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  /* ---- synthetic envelope (demo / no-mic mode) ---- */
  function startSim() {
    if (simTimer) return;
    simTimer = setInterval(() => {
      // speech-like bursts: attack fast, release slow
      const target = Math.random() < 0.72 ? 0.25 + Math.random() * 0.65 : 0.05;
      simLevel += (target - simLevel) * (target > simLevel ? 0.5 : 0.12);
    }, 90);
  }
  function stopSim() {
    clearInterval(simTimer);
    simTimer = null;
    simLevel = 0;
  }

  /* ---- per-frame: fill bandEnergy[] from FFT or simulation ---- */
  function sample() {
    if (analyser && mediaStream) {
      analyser.getByteFrequencyData(freqData);
      const n = freqData.length;              // 256 bins
      for (let b = 0; b < BANDS; b++) {
        // log-spaced band edges across voice-relevant range
        const lo = Math.floor(Math.pow(n * 0.55, b / BANDS)) % n;
        const hi = Math.max(lo + 1, Math.floor(Math.pow(n * 0.55, (b + 1) / BANDS)) % n);
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += freqData[i];
        const v = sum / (hi - lo) / 255;
        // noise-floor gate + gentle curve
        bandEnergy[b] = v < 0.06 ? 0 : Math.pow((v - 0.06) / 0.94, 1.35);
      }
      return overall();
    }
    // simulation: shaped noise around simLevel
    for (let b = 0; b < BANDS; b++) {
      const w = 0.5 + 0.5 * Math.sin(performance.now() / 240 + b * 0.7);
      bandEnergy[b] = simLevel * w * (0.4 + Math.random() * 0.6);
    }
    return simLevel;
  }

  function overall() {
    let sum = 0;
    for (let b = 0; b < BANDS; b++) sum += bandEnergy[b];
    return Math.min(1, (sum / BANDS) * 2.2);
  }

  function bands() { return bandEnergy; }

  function dispose() { stopMic(); stopSim(); if (ctx) ctx.close(); ctx = null; }

  return { startMic, stopMic, sample, bands, overall, dispose };
})();
