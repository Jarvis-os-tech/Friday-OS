# Friday-OS — Architecture & Hermes Delegation Design (LOCKED SPEC)

> Status: **Design-only. No build / threshold data.** Locked 2026-08-29.
> This document is the canonical design for Friday-OS. It is a SPEC, not implementation.
> Friday-OS GitHub repo = **backup mirror only** (not for code-sharing). Personal vault
> (`friday-memory/`) and agent rules (`.agents/`) are intentionally EXCLUDED from this repo.

---

## Role model
- **CEO (Gopi):** sets direction, approves stages, owns final calls.
- **Builder / Manager (Hermes agent):** implements, structures, verifies, reports. Acts as engineering lead on Friday-OS.
- Iteration is staged: implement → commit locally → report → pause for CEO review before next stage.

## 1. Friday core (bridge) — DONE
- `server/hermesBridge.ts` → `execHermes` invokes the REAL Hermes CLI (verified working form):
  `hermes chat --query-file <tmpfile> -Q --max-turns N --yolo --source tool`
  - NO `--oneshot` (real `chat` has no such flag — was the original bug).
  - Strip `Warning: Unknown toolsets: omh` and `session_id:` lines from stdout.
  - `--source tool` separates FRIDAY delegations from normal user sessions.
  - `--max-turns` cap + hard timeout in `.env` (`HERMES_MAX_TURNS`, `HERMES_TIMEOUT_MS`).
- `checkHermesHealth()` probes binary + optional `hermes serve` gateway (127.0.0.1:9119).
- REST: `GET /api/hermes/health`, `POST /api/hermes/chat`, `POST /api/skills/execute`.
- Hermes binary: `/home/gopi/.local/bin/hermes` v0.20.6.

## 2. Topology — OPTION B (chosen)
Each DEPARTMENT = its own Hermes PROFILE. FRIDAY routes into a PERSISTENT named thread per dept.
```
USER (voice) → FRIDAY (cheap model, full access, classifies intent)
   → hermes -p <dept> chat --continue friday-<dept> --create-if-missing --source tool --query-file <tmp> -Q --yolo --max-turns N
```
- `--continue friday-<dept> --create-if-missing` = create thread once, then keep appending →
  one growing Telegram-style chat under each profile in Hermes Desktop Sessions sidebar.
- Context stays ISOLATED per department (tokens stay low). Shared memory still recallable.
- In Hermes Desktop, switch profile in the rail (or `gateway.multiplex_profiles: true`) to view
  each department's threads separately — exactly the "Telegram separate chats" UX.

## 3. Department profiles (proposed default list — confirm before build)
| Profile     | Handles                                  |
|-------------|------------------------------------------|
| research    | web research, grounding, news            |
| coder       | code, builds, debugging                  |
| personal    | Obsidian/Jarvis-memory vault, reminders  |
| finance     | expenses, budgets (optional)             |
| creative    | writing, media, design (optional)         |
| ops         | scheduling, cron, orchestration (optional)|
`default` profile stays as "you / FRIDAY core".

## 4. Memory — FEDERATED, not merged, not disabled
- `jarvis-memory/` (in Friday project) = UNIVERSAL MEMORY ROOT. Already a full Obsidian vault
  (has `.obsidian/`), already wired to FRIDAY via `obsidian_*` skills + `getVaultPath()`.
- Hermes profiles use `jarvis-memory/` as their EXTERNAL MEMORY PROVIDER → both FRIDAY and Hermes
  can recall all; writes scoped per department subfolder.
- Structured subfolders: `jarvis-memory/research/`, `coder/`, `personal/`, ... + `_index.json`
  (tags/links for fast recall).
- WRITE SCOPING GUARD: only the owner-profile + FRIDAY may write a department's folder; all others
  recall-only. Prevents cross-agent state compounding (Hermes docs warn against this).
- Obsidian = the Telegram-style VIEWER across all departments' memory.
- Fallback if Hermes external-provider wiring is awkward: FRIDAY is the write gateway to
  `jarvis-memory/`; Hermes profiles recall via `getVaultPath()`/symlink into that root.
- NOTE: user also has a separate `friday-memory/` store (MEMORY.md/USER.md/Research/conversations/
  context). That store is EXCLUDED from this repo (separate backup). Decide at build time whether to
  merge into `jarvis-memory/` or keep as a second root.

## 5. Future: OpenClaw + other platforms (design now, build later)
- ADAPTER LAYER so FRIDAY routes platform-agnostically: `send(task, target) → result`.
  - Hermes adapter → `hermes -p <dept> chat ...`
  - OpenClaw adapter → its local CLI/HTTP API
  - Future adapter → another entry; FRIDAY doesn't care which framework
- `agents.registry.json` manifest makes this future-proof:
  ```jsonc
  {
    "research":  { "platform": "hermes",  "profile": "research", "rate_limit_pool": "pool-1" },
    "coder":     { "platform": "hermes",  "profile": "coder",    "rate_limit_pool": "pool-2" },
    "assistant": { "platform": "openclaw","endpoint": "localhost:7878" },
    "future-x":  { "platform": "mcp",     "server": "..." }
  }
  ```
  Adding OpenClaw later = ONE entry, no FRIDAY rewrite.
- Department-only awareness via Hermes KANBAN board (profile-stamped), not shared context.
- FRIDAY reads all boards; each dept reads only its own.

## 6. Build order (when CEO says implement)
1. Create department profiles: `hermes profile create <dept>` (×N).
2. Bridge: add `profile` + `sessionName` params → `hermes -p <dept> chat --continue friday-<dept> --create-if-missing ...`.
3. Wire FRIDAY `category` → profile mapping (in `parallelTaskManager`/`server.ts`).
4. `jarvis-memory/<dept>/` subfolders + point Hermes external-provider / `getVaultPath()` there.
5. Write-scoping guard. (Optional) start `hermes serve` for green gateway indicator.

## 7. Caveats
- Bridge uses `--yolo` (auto-approves Hermes commands) — intentional for personal-assistant bridge.
- No `hermes serve` running → health shows `connected:false` but CLI delegation still works.
- Friday task history is IN-MEMORY (resets on server restart); real work persists as Hermes sessions
  (resumable via `hermes chat --resume <id>`).
- NEVER commit/push `.env` (contains GEMINI_API_KEY). Confirm gitignore before any commit.
- Fork push rule (retired JARVIS-OS): explicit per-push approval was required; Friday-OS is the backup
  fork and the CEO directs pushes.
- This repo is CODE + DESIGN only. Personal vault (`friday-memory/`) and `.agents/` are backed up
  separately / kept local.
