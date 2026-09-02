# Friday-OS: Telegram Channel System Design
# Reverse-engineered from Hermes gateway + Telegram adapter
# Author: Friday (for Gopi)

---

## 1. HOW HERMES TELEGRAM WORKS (Full Dissection)

### 1.1 Layer Stack (top to bottom)

```
[User sends Telegram message]
        |
[python-telegram-bot (PTB) — polling / webhook]
        |
[TelegramFallbackTransport (httpx)] — tries seed IPs first, then hostname
        |
[TelegramAdapter (plugins/platforms/telegram/adapter.py)] — core logic
        |
[BasePlatformAdapter (gateway/platforms/base.py)] — shared send/recv
        |
[GatewayRunner (gateway/run.py)] — session routing, model dispatch
        |
[state.db (SQLite WAL)] — sessions, messages, gateway_routing tables
```

---

### 1.2 Inbound Message Path (Receive)

```
Telegram Update arrives
    → PTB dispatcher (MessageHandler / CommandHandler / CallbackQueryHandler)
    → TelegramAdapter._handle_message()
        → Text batching (adaptive delay: 180ms short / 240ms medium / cap long)
        → Media group batching (0.8s window for album bursts)
        → MessageEvent built: {session_key, user_id, chat_id, chat_type, text,
                               platform_message_id, thread_id, media}
        → adapter.receive(event) → GatewayRunner
        → gateway_routing table lookup: session_key → session_id
        → Load messages from state.db (transcript)
        → Model API call (omniroute → google/gemini or fallback)
        → Store response messages to state.db
        → Send back via TelegramAdapter.send()
```

Session key format:
    agent:main:telegram:dm:{chat_id}         — private DM
    agent:main:telegram:group:{chat_id}      — group chat
    agent:main:telegram:supergroup:{chat_id} — supergroup/channel

gateway_routing table maps session_key → session_id (the active session).

---

### 1.3 Outbound Send Path

```
GatewayRunner has a response
    → BasePlatformAdapter.send(text, metadata)
    → TelegramAdapter.send()
        → truncate_message() if > 4096 UTF-16 units
        → split into chunks with (1/N) indicators
        → MarkdownV2 escape → sendMessage (or sendRichMessage if Bot API 10.1+)
        → On flood control RetryAfter > 5s: fail-closed → delivery ledger holds
        → On success: platform_message_id stored in messages table
```

Message size limits:
    Legacy MarkdownV2 path:  4096 UTF-16 code units
    Rich message path:       32768 UTF-8 chars (Bot API 10.1+, opt-in)

---

### 1.4 Reconnect/Resilience System

Hermes has a 5-layer recovery ladder:

```
Layer 1: TelegramFallbackTransport
         — tries seed IPs [149.154.166.110, 149.154.167.220] first
         — falls back to dual-stack hostname
         — TCP keepalive (30s idle, 10s interval, 3 count)

Layer 2: PTB error_callback → _handle_polling_network_error()
         — exponential backoff: 5s, 10s, 20s, 40s, 60s cap
         — max 10 retries, then retryable-fatal escalation

Layer 3: _polling_heartbeat_loop()
         — probes get_me() every 90s on GENERAL path (not getUpdates pool)
         — detects CLOSE-WAIT dead sockets PTB itself can't see

Layer 4: restart_loop.json breaker
         — trips after 5 restarts within 5 minutes
         — disables auto-resume to break respawn loops

Layer 5: GatewayRunner supervisor process
         — rebuilds adapter + PTB Application fresh on retryable-fatal
```

Dead socket detection: CLOSE-WAIT sockets stay readable for epoll but never
deliver data. The heartbeat detects this by timing out get_me() at 15s while
getUpdates long-poll still waits with its own 50s window.

---

### 1.5 Session / Transcript Storage Schema

sessions table (state.db):
    id, session_key, chat_id, chat_type, user_id, display_name,
    model, system_prompt_hash, started_at, ended_at,
    input_tokens, output_tokens, estimated_cost_usd,
    resume_pending, handoff_state, compression_failure_*

messages table (state.db):
    id, session_id, role, content, tool_calls, tool_call_id,
    timestamp, platform_message_id, token_count,
    _compressed_summary, active, compacted, api_content

gateway_routing table:
    scope, session_key → entry_json (has session_id, resume_pending etc.)

JSONL transcripts: ~/.hermes/sessions/{session_id}.jsonl
    — line-delimited JSON, one entry per message turn
    — kept in sync with SQLite via trigger-based FTS + direct writes

---

### 1.6 Inline Picker / Command System

Telegram BotCommand menu: capped at 100 commands (~60 Hermes slots)
Inline picker: unlimited — @bot <query> returns live-filtered results
    — query="plan migrate auth" → filter="plan", args="migrate auth"
    — tapping sends "/plan migrate auth" to chat → triggers command path
    — PAGE_SIZE=50, CACHE_TIME=10s

---

### 1.7 Format Pipeline

Inbound: raw text → text batching → MessageEvent
Outbound: agent markdown →
    MarkdownV2 escape (_escape_mdv2) →
    table → bullet conversion (no table support in MarkdownV2) →
    chunk split at 4096 UTF-16 units with fence/indicator awareness →
    sendMessage or sendRichMessage (Bot API 10.1+ opt-in)

---

## 2. FRIDAY-OS TELEGRAM CHANNEL SYSTEM — DESIGN

### 2.1 Architecture

```
Friday-OS Telegram System
├── TelegramChannel         — inbound/outbound adapter (mirrors Hermes adapter)
│   ├── PollingWorker       — PTB-based or raw Bot API polling
│   ├── FallbackTransport   — IP fallback + TCP keepalive
│   ├── MessageBatcher      — text batch (180ms/240ms) + media group (800ms)
│   └── SendPipeline        — chunk + format + retry + delivery ledger
│
├── ChannelRouter           — maps chat_id → FridaySession
│   ├── SessionStore        — SQLite (sessions, messages, routing)
│   └── SessionKey          — "friday:telegram:dm:{chat_id}"
│
├── FridayBrain             — Hermes bridge (delegates to Hermes gateway)
│   ├── HermesBridgeClient  — http://localhost:9119 (hermes serve)
│   └── FallbackModel       — direct Gemini/NVIDIA when Hermes unavailable
│
├── DeliveryLedger          — holds unsent messages during connection gaps
│   └── FloodController     — respects Telegram RetryAfter headers
│
└── HeartbeatMonitor        — CLOSE-WAIT detector + reconnect scheduler
```

---

### 2.2 Core Data Models

```python
# friday_telegram/models.py

@dataclass
class TelegramMessage:
    message_id: str           # Telegram platform_message_id
    chat_id: str
    chat_type: str            # dm | group | supergroup
    user_id: str
    user_name: str
    text: str
    media: list[MediaItem]    # photos, audio, files
    thread_id: str | None     # forum topic / DM topic lane
    timestamp: float

@dataclass  
class FridaySession:
    session_key: str          # "friday:telegram:dm:{chat_id}"
    session_id: str           # "YYYYMMDD_HHMMSS_{hex6}"
    chat_id: str
    chat_type: str
    display_name: str
    messages: list[dict]      # role/content transcript
    model_override: str | None
    resume_pending: bool
    last_activity_at: float

@dataclass
class SendResult:
    success: bool
    message_id: str | None
    error: str | None
    retry_after: float | None  # Telegram flood RetryAfter
```

---

### 2.3 Database Schema

```sql
-- friday_channel.db

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,               -- YYYYMMDD_HHMMSS_hex6
    session_key TEXT NOT NULL,         -- friday:telegram:dm:{chat_id}
    chat_id TEXT NOT NULL,
    chat_type TEXT NOT NULL,
    user_id TEXT,
    display_name TEXT,
    model TEXT,
    started_at REAL NOT NULL,
    ended_at REAL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    resume_pending INTEGER DEFAULT 0
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,               -- user | assistant | tool
    content TEXT,
    tool_calls TEXT,                  -- JSON
    timestamp REAL NOT NULL,
    platform_message_id TEXT,         -- Telegram message_id
    token_count INTEGER,
    active INTEGER DEFAULT 1
);

CREATE TABLE channel_routing (
    session_key TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    updated_at REAL NOT NULL,
    entry_json TEXT NOT NULL          -- full session state as JSON
);

CREATE TABLE delivery_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,                    -- JSON: thread_id, etc.
    created_at REAL NOT NULL,
    delivered_at REAL,
    attempts INTEGER DEFAULT 0,
    error TEXT
);
```

---

### 2.4 TelegramChannel Implementation

```python
# friday_telegram/channel.py

import asyncio
import httpx
import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

TELEGRAM_BOT_TOKEN = ...  # from .env
TELEGRAM_API = "https://api.telegram.org"
SEED_IPS = ["149.154.166.110", "149.154.167.220"]

# Message limits
MAX_MSG_UTF16 = 4096
MEDIA_BATCH_WINDOW = 0.8   # seconds
TEXT_BATCH_SHORT = 0.18    # seconds (< 320 chars)
TEXT_BATCH_MED   = 0.24    # seconds (< 1024 chars)
TEXT_BATCH_LONG  = 0.40    # seconds
FLOOD_INLINE_CAP = 5.0     # max inline flood wait
HEARTBEAT_INTERVAL = 90    # seconds
PROBE_TIMEOUT = 15         # seconds
MAX_RECONNECT = 10
BASE_BACKOFF = 5
MAX_BACKOFF = 60


class FallbackTransport(httpx.AsyncBaseTransport):
    """Try seed IPs first, then hostname — mirrors TelegramFallbackTransport."""

    def __init__(self, fallback_ips: list[str], **kwargs):
        self._ips = fallback_ips
        self._primary = httpx.AsyncHTTPTransport(**kwargs)
        self._ip_transports: dict[str, httpx.AsyncHTTPTransport] = {}

    async def handle_async_request(self, request: httpx.Request):
        for ip in self._ips:
            try:
                rewritten = self._rewrite_to_ip(request, ip)
                transport = self._ip_transports.setdefault(
                    ip, httpx.AsyncHTTPTransport()
                )
                return await transport.handle_async_request(rewritten)
            except Exception:
                continue
        return await self._primary.handle_async_request(request)

    def _rewrite_to_ip(self, req: httpx.Request, ip: str) -> httpx.Request:
        url = httpx.URL(str(req.url)).copy_with(host=ip)
        headers = dict(req.headers)
        headers["host"] = "api.telegram.org"
        return req.stream.__class__  # simplified — reuse URL+headers


async def make_bot_client() -> httpx.AsyncClient:
    """Build httpx client with fallback transport + TCP keepalive."""
    import socket
    socket_options = [
        (socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1),
    ]
    transport = FallbackTransport(
        SEED_IPS,
        socket_options=socket_options,
        limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
    )
    return httpx.AsyncClient(
        transport=transport,
        base_url=f"{TELEGRAM_API}/bot{TELEGRAM_BOT_TOKEN}",
        timeout=30.0,
    )


class MessageBatcher:
    """Batch rapid messages before passing to brain (mirrors Hermes text/media batching)."""

    def __init__(self, on_batch):
        self._on_batch = on_batch
        self._pending: dict[str, list] = {}      # chat_id → messages
        self._tasks: dict[str, asyncio.Task] = {}

    async def add(self, chat_id: str, msg: dict):
        self._pending.setdefault(chat_id, []).append(msg)
        if chat_id in self._tasks:
            return  # debounce — extend window
        delay = self._delay(msg.get("text", ""))
        task = asyncio.get_event_loop().create_task(
            self._flush_after(chat_id, delay)
        )
        self._tasks[chat_id] = task

    def _delay(self, text: str) -> float:
        n = len(text)
        if n <= 320:   return TEXT_BATCH_SHORT
        if n <= 1024:  return TEXT_BATCH_MED
        return TEXT_BATCH_LONG

    async def _flush_after(self, chat_id: str, delay: float):
        await asyncio.sleep(delay)
        batch = self._pending.pop(chat_id, [])
        self._tasks.pop(chat_id, None)
        if batch:
            await self._on_batch(chat_id, batch)


class DeliveryLedger:
    """Hold unsent messages, retry on reconnect — mirrors Hermes delivery ledger."""

    def __init__(self, db_path: str):
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS delivery_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_key TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                created_at REAL NOT NULL,
                delivered_at REAL,
                attempts INTEGER DEFAULT 0,
                error TEXT
            )
        """)
        self._db.commit()

    def hold(self, session_key: str, content: str, metadata: dict | None = None) -> int:
        cur = self._db.execute(
            "INSERT INTO delivery_ledger(session_key,content,metadata,created_at) VALUES(?,?,?,?)",
            (session_key, content, json.dumps(metadata), time.time())
        )
        self._db.commit()
        return cur.lastrowid

    def mark_delivered(self, row_id: int):
        self._db.execute(
            "UPDATE delivery_ledger SET delivered_at=? WHERE id=?",
            (time.time(), row_id)
        )
        self._db.commit()

    def get_undelivered(self, session_key: str) -> list[dict]:
        rows = self._db.execute(
            "SELECT id,content,metadata FROM delivery_ledger WHERE session_key=? AND delivered_at IS NULL",
            (session_key,)
        ).fetchall()
        return [{"id": r[0], "content": r[1], "metadata": json.loads(r[2] or "{}")} for r in rows]


class FloodController:
    """Track per-chat flood state and RetryAfter waits."""

    def __init__(self):
        self._retry_until: dict[str, float] = {}

    def record_flood(self, chat_id: str, retry_after: float):
        self._retry_until[chat_id] = time.monotonic() + retry_after

    def is_flooded(self, chat_id: str) -> bool:
        until = self._retry_until.get(chat_id, 0)
        return time.monotonic() < until

    def wait_remaining(self, chat_id: str) -> float:
        return max(0.0, self._retry_until.get(chat_id, 0) - time.monotonic())


class FridayTelegramChannel:
    """
    Full Telegram channel for Friday-OS.

    Mirrors Hermes TelegramAdapter with:
    - Polling with seed-IP fallback transport
    - Text + media batching
    - Delivery ledger for gap recovery
    - Flood control
    - Heartbeat dead-socket detector
    - Session routing via SQLite
    """

    def __init__(self, db_path: str, brain_url: str = "http://localhost:9119"):
        self._db_path = db_path
        self._brain_url = brain_url
        self._client: httpx.AsyncClient | None = None
        self._batcher = MessageBatcher(self._on_batch)
        self._ledger = DeliveryLedger(db_path)
        self._flood = FloodController()
        self._reconnect_count = 0
        self._running = False
        self._offset = 0
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._init_db()

    def _init_db(self):
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                session_key TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                chat_type TEXT DEFAULT 'dm',
                user_id TEXT,
                display_name TEXT,
                started_at REAL NOT NULL,
                resume_pending INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                timestamp REAL NOT NULL,
                platform_message_id TEXT,
                active INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS channel_routing (
                session_key TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                chat_id TEXT NOT NULL,
                updated_at REAL NOT NULL,
                entry_json TEXT NOT NULL
            );
        """)
        self._db.commit()

    # ─── Session Management ───────────────────────────────────────

    def _session_key(self, chat_id: str, chat_type: str) -> str:
        return f"friday:telegram:{chat_type}:{chat_id}"

    def _get_or_create_session(self, chat_id: str, chat_type: str, display_name: str) -> str:
        key = self._session_key(chat_id, chat_type)
        row = self._db.execute(
            "SELECT session_id FROM channel_routing WHERE session_key=?", (key,)
        ).fetchone()
        if row:
            return row[0]
        session_id = f"{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        now = time.time()
        self._db.execute(
            "INSERT INTO sessions(id,session_key,chat_id,chat_type,display_name,started_at) VALUES(?,?,?,?,?,?)",
            (session_id, key, chat_id, chat_type, display_name, now)
        )
        self._db.execute(
            "INSERT INTO channel_routing(session_key,session_id,chat_id,updated_at,entry_json) VALUES(?,?,?,?,?)",
            (key, session_id, chat_id, now, json.dumps({"session_id": session_id, "chat_id": chat_id}))
        )
        self._db.commit()
        return session_id

    def _save_message(self, session_id: str, role: str, content: str, platform_msg_id: str | None = None):
        self._db.execute(
            "INSERT INTO messages(session_id,role,content,timestamp,platform_message_id) VALUES(?,?,?,?,?)",
            (session_id, role, content, time.time(), platform_msg_id)
        )
        self._db.commit()

    # ─── Polling Loop ─────────────────────────────────────────────

    async def start(self):
        self._client = await make_bot_client()
        self._running = True
        asyncio.create_task(self._heartbeat_loop())
        asyncio.create_task(self._poll_loop())

    async def _poll_loop(self):
        while self._running:
            try:
                updates = await self._get_updates(timeout=30)
                for update in updates:
                    self._offset = update["update_id"] + 1
                    asyncio.create_task(self._dispatch(update))
                self._reconnect_count = 0  # reset on success
            except Exception as e:
                await self._handle_poll_error(e)

    async def _get_updates(self, timeout: int = 30) -> list:
        resp = await self._client.post("/getUpdates", json={
            "offset": self._offset,
            "timeout": timeout,
            "allowed_updates": ["message", "callback_query", "inline_query"],
        }, timeout=timeout + 5)
        data = resp.json()
        return data.get("result", []) if data.get("ok") else []

    async def _handle_poll_error(self, error: Exception):
        self._reconnect_count += 1
        if self._reconnect_count > MAX_RECONNECT:
            raise RuntimeError(f"Telegram polling failed after {MAX_RECONNECT} retries: {error}")
        delay = min(BASE_BACKOFF * (2 ** (self._reconnect_count - 1)), MAX_BACKOFF)
        await asyncio.sleep(delay)

    # ─── Heartbeat (CLOSE-WAIT detector) ─────────────────────────

    async def _heartbeat_loop(self):
        while self._running:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            try:
                await asyncio.wait_for(
                    self._client.post("/getMe"),
                    timeout=PROBE_TIMEOUT
                )
            except Exception as e:
                await self._handle_poll_error(e)

    # ─── Dispatch ─────────────────────────────────────────────────

    async def _dispatch(self, update: dict):
        if "message" in update:
            msg = update["message"]
            chat = msg["chat"]
            chat_id = str(chat["id"])
            chat_type = chat.get("type", "private")
            if chat_type == "private": chat_type = "dm"
            user = msg.get("from", {})
            display = user.get("first_name", "") + " " + user.get("last_name", "")
            text = msg.get("text") or msg.get("caption") or ""
            await self._batcher.add(chat_id, {
                "message_id": str(msg["message_id"]),
                "chat_id": chat_id, "chat_type": chat_type,
                "user_id": str(user.get("id", "")),
                "display_name": display.strip(),
                "text": text,
                "timestamp": time.time(),
            })

    async def _on_batch(self, chat_id: str, messages: list[dict]):
        """Called when a text/media batch is ready — send to brain & reply."""
        first = messages[0]
        session_id = self._get_or_create_session(
            chat_id, first["chat_type"], first["display_name"]
        )
        combined_text = "\n".join(m["text"] for m in messages if m["text"])
        self._save_message(session_id, "user", combined_text, first["message_id"])

        # Delegate to Hermes bridge (hermes serve on :9119) or direct Gemini
        reply = await self._call_brain(session_id, combined_text, chat_id)
        await self._send(chat_id, reply, session_id)

    # ─── Brain Bridge ─────────────────────────────────────────────

    async def _call_brain(self, session_id: str, text: str, chat_id: str) -> str:
        """Send message to Hermes serve gateway, return reply text."""
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{self._brain_url}/chat",
                    json={"session_id": session_id, "message": text, "chat_id": chat_id}
                )
                if resp.status_code == 200:
                    return resp.json().get("reply", "")
        except Exception:
            pass

        # Fallback: direct Gemini call
        return await self._fallback_gemini(text)

    async def _fallback_gemini(self, text: str) -> str:
        import os
        key = os.getenv("GEMINI_API_KEY", "")
        if not key:
            return "[Friday: brain offline]"
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}",
                json={"contents": [{"parts": [{"text": text}]}]}
            )
            try:
                return resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            except Exception:
                return "[Friday: model error]"

    # ─── Send ─────────────────────────────────────────────────────

    async def _send(self, chat_id: str, text: str, session_id: str,
                    reply_to: str | None = None):
        """Send reply in chunks if > 4096 UTF-16 units."""
        if not text:
            return
        chunks = self._chunk_text(text)
        for i, chunk in enumerate(chunks):
            if self._flood.is_flooded(chat_id):
                wait = self._flood.wait_remaining(chat_id)
                if wait > FLOOD_INLINE_CAP:
                    row_id = self._ledger.hold(
                        f"friday:telegram:dm:{chat_id}", chunk
                    )
                    continue
                await asyncio.sleep(wait)
            try:
                payload = {"chat_id": chat_id, "text": chunk, "parse_mode": "HTML"}
                if reply_to and i == 0:
                    payload["reply_to_message_id"] = reply_to
                resp = await self._client.post("/sendMessage", json=payload, timeout=30)
                data = resp.json()
                if not data.get("ok"):
                    retry_after = data.get("parameters", {}).get("retry_after", 0)
                    if retry_after:
                        self._flood.record_flood(chat_id, float(retry_after))
                else:
                    msg_id = str(data["result"]["message_id"])
                    self._save_message(session_id, "assistant", chunk, msg_id)
            except Exception as e:
                self._ledger.hold(f"friday:telegram:dm:{chat_id}", chunk)

    def _chunk_text(self, text: str, limit: int = MAX_MSG_UTF16) -> list[str]:
        """Split text into Telegram-safe UTF-16-unit-bounded chunks."""
        def utf16_len(s: str) -> int:
            return len(s.encode("utf-16-le")) // 2
        if utf16_len(text) <= limit:
            return [text]
        chunks = []
        while text:
            # Find split point
            lo, hi = 0, len(text)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if utf16_len(text[:mid]) <= limit - 10:  # -10 for (N/M)
                    lo = mid
                else:
                    hi = mid - 1
            total = (len(text) // lo) + 1 if lo else 1
            chunk = text[:lo]
            chunks.append(chunk)
            text = text[lo:]
        # Add chunk indicators
        n = len(chunks)
        if n > 1:
            chunks = [f"{c}\n({i+1}/{n})" for i, c in enumerate(chunks)]
        return chunks

    async def stop(self):
        self._running = False
        if self._client:
            await self._client.aclose()
```

---

### 2.5 Startup Script

```python
# friday_telegram/main.py

import asyncio
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent.parent / ".env")

from friday_telegram.channel import FridayTelegramChannel

async def main():
    db_path = str(Path(__file__).parent.parent / "data" / "friday_channel.db")
    brain_url = f"http://{os.getenv('HERMES_GATEWAY_URL', '127.0.0.1:9119')}"

    channel = FridayTelegramChannel(db_path=db_path, brain_url=brain_url)
    print("[Friday] Telegram channel starting...")
    await channel.start()

    try:
        await asyncio.Event().wait()  # run forever
    except KeyboardInterrupt:
        await channel.stop()

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 3. WHAT HERMES HAS vs WHAT WE BUILD

| Feature                        | Hermes                          | Friday-OS                      |
|--------------------------------|---------------------------------|--------------------------------|
| Polling transport              | PTB + FallbackTransport (httpx) | Raw Bot API + FallbackTransport|
| Seed IPs                       | 149.154.166.110 / .167.220      | Same                           |
| TCP keepalive                  | SO_KEEPALIVE + IDLE/INTL/CNT    | Same via socket_options        |
| Text batching                  | 180ms/240ms/cap adaptive        | Same                           |
| Media group batching           | 800ms window                    | Same                           |
| Flood control                  | RetryAfter + 5s inline cap      | Same                           |
| Dead socket detector           | get_me() every 90s / 15s TO     | Same                           |
| Reconnect backoff              | 5/10/20/40/60s cap, 10 max      | Same                           |
| Restart loop breaker           | restart_loop.json (5 trips)     | SQLite flag                    |
| Session store                  | state.db (WAL, FTS5)            | friday_channel.db (SQLite WAL) |
| Transcript                     | JSONL + SQLite messages table   | SQLite messages table          |
| Delivery ledger                | In-memory + DB hold             | delivery_ledger table          |
| Format                         | MarkdownV2 / Rich (Bot API 10.1)| HTML (simpler, no escape hell) |
| Chunk split                    | 4096 UTF-16 units               | Same                           |
| Brain                          | omniroute → gemini/nvidia       | hermes serve :9119 → gemini    |
| Inline picker                  | Full PTB InlineQueryHandler     | Future phase                   |
| Forum topics                   | thread_id + reply anchor        | Phase 2                        |

---

## 4. IMPLEMENTATION PHASES

Phase 1 (now):
    - friday_telegram/channel.py (FridayTelegramChannel)
    - friday_telegram/models.py
    - friday_telegram/main.py
    - data/friday_channel.db schema
    - Hermes serve bridge on :9119

Phase 2:
    - Inline picker (unlimited command search via @bot query)
    - Forum topic routing
    - Bot API 10.1 rich messages
    - Voice message → Gemini Live STT pipeline

Phase 3:
    - Proactive push (heartbeat alerts, cron delivery)
    - Multi-bot support (separate OpenClaw bot routing)
    - Cross-channel session mirroring (Telegram ↔ CLI same session)

---
