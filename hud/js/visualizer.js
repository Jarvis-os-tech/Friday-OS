/* ============================================================
   visualizer.js — Canvas halo around the arc reactor
   Radial frequency spikes + soft ring bloom. Renders from
   AudioEngine.bands(); amplitude driven by state + level.
   ============================================================ */
"use strict";

const Halo = (() => {
  let canvas = null;
  let ctx2d = null;
  let rafId = null;
  let level = 0;            // smoothed master level 0..1
  let targetLevel = 0;
  let phase = 0;
  const BANDS = 48;

  function mount(el) {
    canvas = el;
    ctx2d = el.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function start() {
    if (rafId) return;
    loop();
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = null;
    // clear canvas on stop
    if (ctx2d && canvas) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function setTarget(v) { targetLevel = v; }

  function loop() {
    rafId = requestAnimationFrame(loop);
    draw();
  }

  function draw() {
    if (!ctx2d) return;
    const W = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
    const H = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
    const cx = W / 2, cy = H / 2;
    const baseR = Math.min(W, H) * 0.30;      // just outside the SVG reactor

    // envelope smoothing (attack fast, release slow)
    level += (targetLevel - level) * (targetLevel > level ? 0.35 : 0.08);

    ctx2d.clearRect(0, 0, W, H);
    phase += 0.02 + level * 0.05;

    const energy = AudioEngine.bands();

    /* ---- radial spikes ---- */
    const spikes = 96;                         // interpolate bands → spikes
    for (let i = 0; i < spikes; i++) {
      const bandIdx = Math.floor((i % BANDS));
      const mirror = i >= spikes / 2 ? BANDS - 1 - bandIdx : bandIdx;
      const e = energy[mirror] || 0;
      const amp = e * baseR * 0.85;
      if (amp < 1.2) continue;
      const a = (i / spikes) * Math.PI * 2 + phase * 0.6;
      const x1 = cx + Math.cos(a) * (baseR + 4);
      const y1 = cy + Math.sin(a) * (baseR + 4);
      const x2 = cx + Math.cos(a) * (baseR + 4 + amp);
      const y2 = cy + Math.sin(a) * (baseR + 4 + amp);
      ctx2d.strokeStyle = `rgba(0,212,255,${0.12 + e * 0.55})`;
      ctx2d.lineWidth = 1.5;
      ctx2d.beginPath();
      ctx2d.moveTo(x1, y1);
      ctx2d.lineTo(x2, y2);
      ctx2d.stroke();
    }

    /* ---- pulsing halo rings ---- */
    const rings = 2;
    for (let r = 0; r < rings; r++) {
      const rr = baseR * (1 + 0.06 + ((phase * 0.5 + r * 0.5) % 1) * (0.35 + level * 0.4));
      const alpha = (1 - ((phase * 0.5 + r * 0.5) % 1)) * (0.10 + level * 0.30);
      if (alpha <= 0.01) continue;
      ctx2d.strokeStyle = `rgba(0,212,255,${alpha})`;
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx2d.stroke();
    }

    /* ---- ambient glow disc ---- */
    if (level > 0.03) {
      const g = ctx2d.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * (1.15 + level * 0.25));
      g.addColorStop(0, `rgba(0,212,255,${0.05 + level * 0.10})`);
      g.addColorStop(1, "rgba(0,212,255,0)");
      ctx2d.fillStyle = g;
      ctx2d.fillRect(0, 0, W, H);
    }
  }

  return { mount, start, stop, setTarget };
})();
