# J.A.R.V.I.S — Voice Assistant UI/UX

A complete, working HUD design for a Jarvis/Friday-style voice agent.
Zero dependencies, no build step — open `index.html` in Chrome/Edge and it runs.

![states](https://img.shields.io/badge/states-idle%20·%20listening%20·%20thinking%20·%20speaking%20·%20error-00d4ff)

## Run it

```bash
# any static server, or just open the file
google-chrome index.html
```

Best experienced in Chrome/Edge (Web Speech API + real mic waveform).
Firefox: UI fully works, speech input falls back to simulated turns / typed commands.

## Interaction model

| Input | Action |
|---|---|
| Click the core / `Space` | Start listening (push-to-talk) |
| `Esc` | Stop/interrupt instantly (barge-in) |
| `Ctrl/⌘ + K` | Type a command (full keyboard parity) |
| `#state=listening\|thinking\|speaking` in URL | Preview any state (demo hook) |

## Voice state machine

```
idle ──activate──▶ listening ──final transcript──▶ thinking ──response──▶ speaking
  ▲                    │ mic denied                   │                      │
  └────────────────────┴──────── error ───────────────┴────── done ──────────┘
```

State is expressed through **color + motion + label** (never color alone):

| State | Tint | Motion signature | Label |
|---|---|---|---|
| Idle | Cyan | Slow 4.8s breathing pulse | STANDBY |
| Listening | Mint `#4dffc3` | Halo spikes react to **mic input** level | LISTENING |
| Thinking | Amber `#ffb800` | Rings accelerate + spinner arc engages | PROCESSING |
| Speaking | Bright cyan | Halo reacts to **output** cadence | RESPONDING |
| Error | Red `#ff4757` | Fast pulse + typed-input recovery hint | MIC OFFLINE |

Semantic state and audio level are deliberately separate signals — a noisy room
never makes an idle agent look active.

## Design tokens (`css/tokens.css`)

- **Palette** — deep-navy canvas `#050a14`, primary holo-cyan `#00d4ff`,
  amber warning `#ffb800`, red critical `#ff4757`, green nominal `#26de81`.
  Monochrome discipline: one dominant hue; color means *status*, never decoration.
- **Type stack** (Google Fonts) — `Orbitron` display · `Rajdhani` UI labels ·
  `Exo 2` body · `Share Tech Mono` telemetry. Wide tracking, uppercase micro-labels.
- **Glow recipes** — emission via layered `box-shadow`/`drop-shadow`, never blur-radius
  animation (keeps GPU cost flat). Backgrounds are never pure black.
- **Motion** — `--t-breathe` 4.8s idle, 26s/38s counter-rotating rings, 6s radar sweep.
  Everything honors `prefers-reduced-motion` (near-instant boot, static rings).

## Architecture

```
index.html          HUD shell: topbar · left diagnostics · orb · right context · transcript
css/
  tokens.css        design tokens — every visual decision resolves here
  base.css          stage grid, polar/cartesian underlay, scanlines, vignette
  components.css    panels, corner brackets, badges, meters, radar, materialize-in
  orb.css           arc reactor + per-state tinting/motion
  layout.css        regions, transcript, command palette, responsive
  boot.css          cinematic boot overlay
js/
  app.js            state machine + keyboard/pointer wiring + demo brain
  audio.js          getUserMedia → AnalyserNode → 48 log-spaced bands (sim fallback)
  visualizer.js     canvas halo: radial frequency spikes + pulse rings
  speech.js         SpeechRecognition (STT) + speechSynthesis (TTS) wrappers
  panels.js         clock, gauges, sparklines, radar blips (labeled DEMO where fake)
  boot.js           boot sequence, skippable, reduced-motion aware
```

## UX decisions baked in

- **Ephemeral-then-persistent transcript**: live captions under the orb + reserved
  "live slot" in the log (no layout jump), full log persists, auto-scrolls only
  when already pinned to bottom.
- **Interruptibility**: `Esc` or click kills TTS instantly (`speechSynthesis.cancel`)
  and returns to listening — lag here reads as broken.
- **Accessibility**: captions toggle (CC), screen-reader state announcer
  (`aria-live`), visible focus rings, full keyboard parity, typed command palette,
  reduced-motion support.
- **Honest failure**: mic-denied shows MIC OFFLINE + typed-input recovery;
  simulated data is labeled `DEMO DATA`; no-mic mode still demos the full flow.

## Wiring a real brain

Replace the demo pieces, everything else stays:

1. `js/app.js → respond()` — call your LLM/agent backend instead of `RESPONSES[]`.
2. `js/speech.js` — swap STT/TTS for your pipeline (Whisper, ElevenLabs, etc.);
   keep the `onBoundary`-style level events so the orb stays reactive.
3. `js/audio.js` — if your TTS returns audio, route it through an `AnalyserNode`
   and feed `Halo.setTarget()` for true output-reactive visuals.
4. `js/panels.js` — bind gauges/weather/agenda to real telemetry.
