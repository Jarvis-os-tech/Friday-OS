/* ============================================================
   boot.js — Cinematic boot sequence
   Progress ring + typed syscheck log → hands off to app.
   Skippable via click/keypress. Reduced-motion: near-instant.
   ============================================================ */
"use strict";

const Boot = (() => {
  const LINES = [
    { text: "> NEURAL CORE .............. ", tag: "key", status: "ONLINE", cls: "ok" },
    { text: "> LANGUAGE MATRIX .......... ", tag: "key", status: "LOADED", cls: "ok" },
    { text: "> AUDIO SPECTRUM ANALYZER .. ", tag: "key", status: "CALIBRATED", cls: "ok" },
    { text: "> SPEECH SYNTHESIS ......... ", tag: "key", status: "READY", cls: "ok" },
    { text: "> TELEMETRY UPLINK ......... ", tag: "warn", status: "DEMO SIGNAL", cls: "warn" },
    { text: "> SECURITY PROTOCOLS ....... ", tag: "key", status: "ENGAGED", cls: "ok" },
    { text: "", tag: null, status: "" },
    { text: "> ALL SYSTEMS NOMINAL. GOOD TO SEE YOU. ", tag: null, status: "", cls: "key" },
  ];

  function run(onDone) {
    const el = document.getElementById("boot");
    const prog = el.querySelector(".prog");
    const pct = el.querySelector(".pct");
    const log = el.querySelector(".boot-log");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let finished = false;
    const C = 339.29;

    const finish = () => {
      if (finished) return;
      finished = true;
      el.classList.add("done");
      document.body.classList.add("booted");
      if (onDone) onDone();
    };

    const skip = () => finish();
    el.addEventListener("click", skip);
    window.addEventListener("keydown", function once() {
      window.removeEventListener("keydown", once);
      skip();
    });

    if (reduced) { setTimeout(finish, 350); return; }

    // progress ring
    let p = 0;
    const progIv = setInterval(() => {
      p = Math.min(100, p + (Math.random() * 9 + 3));
      prog.style.strokeDashoffset = C * (1 - p / 100);
      pct.textContent = Math.floor(p);
      if (p >= 100) clearInterval(progIv);
    }, 130);

    // typed lines
    let li = 0;
    const lineIv = setInterval(() => {
      if (li >= LINES.length) {
        clearInterval(lineIv);
        setTimeout(finish, 650);
        return;
      }
      const L = LINES[li++];
      const row = document.createElement("span");
      row.className = `line ${L.cls || ""}`;
      row.innerHTML = `${escapeHtml(L.text)}<span class="key"></span>`;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;

      const keyEl = row.querySelector(".key");
      if (L.status) typeInto(keyEl, L.status, 14);
    }, 260);

    // hard cap so boot never exceeds ~4s
    setTimeout(finish, 4200);
  }

  function typeInto(el, text, speed, cb) {
    let i = 0;
    const iv = setInterval(() => {
      el.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(iv); if (cb) cb(); }
    }, speed);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { run };
})();
