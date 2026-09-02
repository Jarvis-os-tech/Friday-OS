"""
Friday-OS — Telegram Channel Gateway (Complete Implementation)
Reverse-engineered from Hermes gateway + Telegram adapter.

Features:
- Long-polling with TelegramFallbackTransport (seed IPs 149.154.166.110/167.220 + keepalive)
- Active Real-Time Typing Indicators (sendChatAction with 4.0s refresh loop)
- AG UI Protocol event synchronization
- Adaptive text (180ms/240ms/400ms) & media group batching (800ms)
- Delivery ledger for zero message loss across disconnects (SQLite WAL)
- Flood control respecting RetryAfter headers
- Heartbeat dead socket detector (getMe probe every 90s with 15s timeout)
- 5-layer reconnect ladder with exponential backoff and restart breaker
- HTML format pipeline & UTF-16 code unit chunk splitter (max 4096 units)
- Multi-agent brain dispatch (Prime / Hermes / Ultron / Gemini)
"""

import os
import sys
import json
import time
import uuid
import sqlite3
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import httpx
from dotenv import load_dotenv

from .models import TelegramMessage, FridaySession, SendResult, MediaItem, ChatAction
from .transport import make_bot_client, TELEGRAM_API_BASE
from .batcher import MessageBatcher
from .ledger import DeliveryLedger
from .flood import FloodController, FLOOD_INLINE_CAP
from .typing import TypingController
from .formatter import markdown_to_telegram_html, chunk_message, get_utf16_length
from .protocol import ag_ui_bridge, AGUIEventType
from .brain import FridayBrain

log = logging.getLogger("friday.telegram.channel")

# Limits & Tuning
MAX_MSG_UTF16 = 4096
HEARTBEAT_INTERVAL = 90.0  # seconds
PROBE_TIMEOUT = 15.0       # seconds
MAX_RECONNECT = 10
BASE_BACKOFF = 5.0         # seconds
MAX_BACKOFF = 60.0         # seconds
POLL_TIMEOUT = 30          # seconds


class FridayTelegramChannel:
    """
    Complete, production-grade Telegram Channel for Friday-OS.
    """

    def __init__(
        self,
        bot_token: Optional[str] = None,
        allowed_chat_id: Optional[str] = None,
        db_path: Optional[str] = None,
        brain_url: Optional[str] = None,
    ):
        _env_path = Path(__file__).resolve().parent.parent / ".env"
        load_dotenv(_env_path, override=True)

        self._token = (bot_token or os.getenv("TELEGRAM_BOT_TOKEN", "")).strip().strip("\"'")
        self._allowed_chat_id = (allowed_chat_id or os.getenv("TELEGRAM_CHAT_ID", "")).strip().strip("\"'")
        
        default_db = str(Path(__file__).resolve().parent.parent / "data" / "friday_channel.db")
        self._db_path = str(db_path or default_db)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)

        self._client: Optional[httpx.AsyncClient] = None
        self._brain = FridayBrain(brain_url=brain_url)
        self._batcher = MessageBatcher(self._on_batch_received)
        self._ledger = DeliveryLedger(self._db_path)
        self._flood = FloodController()
        self._typing = TypingController(lambda: self._client)

        self._running = False
        self._offset = 0
        self._reconnect_count = 0
        self._poll_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._ledger_flush_task: Optional[asyncio.Task] = None

        self._init_db()

    # ── Database Initialization ───────────────────────────────────────

    def _get_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self):
        """Create sessions, messages, channel_routing, and restart_loop tables."""
        with self._get_db() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    session_key TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    chat_type TEXT DEFAULT 'dm',
                    user_id TEXT,
                    display_name TEXT,
                    started_at REAL NOT NULL,
                    ended_at REAL,
                    model TEXT,
                    input_tokens INTEGER DEFAULT 0,
                    output_tokens INTEGER DEFAULT 0,
                    resume_pending INTEGER DEFAULT 0,
                    last_activity_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(session_key);

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL REFERENCES sessions(id),
                    role TEXT NOT NULL,
                    content TEXT,
                    tool_calls TEXT,
                    timestamp REAL NOT NULL,
                    platform_message_id TEXT,
                    token_count INTEGER,
                    active INTEGER DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

                CREATE TABLE IF NOT EXISTS channel_routing (
                    session_key TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    entry_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS restart_breaker (
                    id INTEGER PRIMARY KEY,
                    restart_timestamp REAL NOT NULL
                );
            """)
            conn.commit()

    # ── Session & Storage Operations ──────────────────────────────────

    def _format_session_key(self, chat_id: str, chat_type: str) -> str:
        c_type = "dm" if chat_type in ("private", "dm") else chat_type
        return f"friday:telegram:{c_type}:{chat_id}"

    def _get_or_create_session(self, chat_id: str, chat_type: str, display_name: str, user_id: str = "") -> FridaySession:
        key = self._format_session_key(chat_id, chat_type)
        now = time.time()

        with self._get_db() as conn:
            row = conn.execute("SELECT session_id, entry_json FROM channel_routing WHERE session_key = ?", (key,)).fetchone()
            if row:
                session_id = row["session_id"]
                s_row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
                if s_row:
                    conn.execute("UPDATE sessions SET last_activity_at = ? WHERE id = ?", (now, session_id))
                    conn.execute("UPDATE channel_routing SET updated_at = ? WHERE session_key = ?", (now, key))
                    conn.commit()
                    return FridaySession(
                        session_key=key,
                        session_id=session_id,
                        chat_id=chat_id,
                        chat_type=chat_type,
                        display_name=display_name,
                        started_at=s_row["started_at"],
                        model=s_row["model"],
                        last_activity_at=now,
                    )

            # Create new session
            session_id = f"{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
            conn.execute(
                """
                INSERT INTO sessions (id, session_key, chat_id, chat_type, user_id, display_name, started_at, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, key, chat_id, chat_type, user_id, display_name, now, now)
            )
            meta = {"session_id": session_id, "chat_id": chat_id, "chat_type": chat_type, "display_name": display_name}
            conn.execute(
                """
                INSERT INTO channel_routing (session_key, session_id, chat_id, updated_at, entry_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (key, session_id, chat_id, now, json.dumps(meta))
            )
            conn.commit()

            return FridaySession(
                session_key=key,
                session_id=session_id,
                chat_id=chat_id,
                chat_type=chat_type,
                display_name=display_name,
                started_at=now,
                last_activity_at=now,
            )

    def _save_message(self, session_id: str, role: str, content: str, platform_message_id: Optional[str] = None):
        with self._get_db() as conn:
            conn.execute(
                """
                INSERT INTO messages (session_id, role, content, timestamp, platform_message_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, role, content, time.time(), platform_message_id)
            )
            conn.commit()

    # ── Restart Loop Breaker (Layer 4) ─────────────────────────────────

    def _check_restart_breaker(self) -> bool:
        """Trip if more than 5 restarts occurred within 5 minutes."""
        now = time.time()
        five_min_ago = now - 300
        with self._get_db() as conn:
            conn.execute("DELETE FROM restart_breaker WHERE restart_timestamp < ?", (five_min_ago,))
            conn.execute("INSERT INTO restart_breaker (restart_timestamp) VALUES (?)", (now,))
            conn.commit()
            count = conn.execute("SELECT COUNT(*) FROM restart_breaker").fetchone()[0]
            if count > 5:
                log.error(f"🚨 Restart loop breaker TRIPPED ({count} restarts in 5m). Halting auto-resume.")
                return False
        return True

    # ── Polling & Inbound Path ────────────────────────────────────────

    async def start(self):
        """Start the Telegram channel workers and connection monitors."""
        if not self._token:
            log.warning("Telegram Bot Token is empty. Channel cannot start.")
            return

        if not self._check_restart_breaker():
            return

        self._running = True
        log.info("🚀 Starting Friday-OS Telegram Channel Gateway...")

        self._client = await make_bot_client(self._token)
        
        # Verify Bot Identity
        try:
            resp = await self._client.post("/getMe", timeout=10.0)
            data = resp.json()
            if data.get("ok"):
                bot_user = data["result"]
                bot_name = bot_user.get("first_name", "Friday Bot")
                bot_username = bot_user.get("username", "Unknown")
                log.info(f"🤖 Connected to Telegram as @{bot_username} ({bot_name})")
            else:
                log.error(f"Telegram Bot Token verification failed: {data}")
        except Exception as e:
            log.warning(f"Initial getMe probe notice: {e}")

        # Sync update offset to skip stale messages
        await self._sync_initial_offset()

        # Start background workers
        self._poll_task = asyncio.create_task(self._poll_loop())
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        self._ledger_flush_task = asyncio.create_task(self._periodic_ledger_flush())

        log.info("🟢 Friday-OS Telegram Channel Gateway is ACTIVE.")

    async def _sync_initial_offset(self):
        if not self._client:
            return
        try:
            resp = await self._client.post("/getUpdates", json={"limit": 1, "offset": -1}, timeout=10.0)
            data = resp.json()
            if data.get("ok") and data.get("result"):
                self._offset = data["result"][-1]["update_id"] + 1
                log.debug(f"Initial Telegram update offset set to {self._offset}")
        except Exception as e:
            log.debug(f"Offset sync note: {e}")

    async def _poll_loop(self):
        """Long-poll getUpdates loop with exponential backoff recovery."""
        while self._running:
            try:
                updates = await self._get_updates(timeout=POLL_TIMEOUT)
                for update in updates:
                    self._offset = update["update_id"] + 1
                    asyncio.create_task(self._dispatch_update(update))
                self._reconnect_count = 0  # reset on healthy poll
            except asyncio.CancelledError:
                break
            except Exception as e:
                await self._handle_poll_error(e)

    async def _get_updates(self, timeout: int = 30) -> List[Dict[str, Any]]:
        """Long-poll getUpdates from Telegram API."""
        if not self._client:
            return []
        resp = await self._client.post(
            "/getUpdates",
            json={
                "offset": self._offset,
                "timeout": timeout,
                "allowed_updates": ["message", "edited_message", "callback_query"],
            },
            timeout=timeout + 8.0,
        )
        data = resp.json()
        if data.get("ok"):
            return data.get("result", [])
        else:
            err = data.get("description", "Unknown Telegram API error")
            log.warning(f"getUpdates returned ok=false: {err}")
            return []

    async def _handle_poll_error(self, error: Exception):
        """Layer 2 exponential backoff recovery ladder."""
        self._reconnect_count += 1
        if self._reconnect_count > MAX_RECONNECT:
            log.error(f"🚨 Telegram polling failed after {MAX_RECONNECT} retries: {error}")
            self._reconnect_count = MAX_RECONNECT

        delay = min(BASE_BACKOFF * (1.5 ** (self._reconnect_count - 1)), MAX_BACKOFF)
        log.warning(f"Polling network error (attempt {self._reconnect_count}/{MAX_RECONNECT}): {error}. Backing off {delay:.1f}s...")
        await asyncio.sleep(delay)

        # Re-instantiate transport if connection died
        try:
            if self._client:
                await self._client.aclose()
            self._client = await make_bot_client(self._token)
            log.info("HTTP transport re-initialized successfully.")
        except Exception as renew_err:
            log.debug(f"Transport renew note: {renew_err}")

    # ── Heartbeat Dead Socket Detector (Layer 3) ──────────────────────

    async def _heartbeat_loop(self):
        """
        Probes getMe() every 90s on general connection path with 15s timeout.
        Detects CLOSE-WAIT dead sockets that standard long-polling can't see.
        """
        while self._running:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if not self._client:
                    continue
                resp = await asyncio.wait_for(
                    self._client.post("/getMe", timeout=PROBE_TIMEOUT),
                    timeout=PROBE_TIMEOUT + 2.0
                )
                if not resp.json().get("ok"):
                    log.warning("Heartbeat probe returned ok=false, refreshing connection...")
                    await self._handle_poll_error(RuntimeError("Heartbeat probe failed"))
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning(f"Dead socket heartbeat detector triggered ({e}), recycling transport...")
                await self._handle_poll_error(e)

    # ── Update Dispatcher & Message Processing ────────────────────────

    async def _dispatch_update(self, update: Dict[str, Any]):
        """Parse update and queue into MessageBatcher."""
        raw_msg = update.get("message") or update.get("edited_message")
        if not raw_msg:
            return

        chat = raw_msg.get("chat", {})
        chat_id = str(chat.get("id", ""))
        chat_type = chat.get("type", "private")
        if chat_type == "private":
            chat_type = "dm"

        # Security: Enforce authorized chat ID if configured
        if self._allowed_chat_id and chat_id != self._allowed_chat_id:
            log.warning(f"Ignoring message from unauthorized Telegram chat ID: {chat_id}")
            return

        user = raw_msg.get("from", {})
        user_id = str(user.get("id", ""))
        first_name = user.get("first_name", "")
        last_name = user.get("last_name", "")
        display_name = f"{first_name} {last_name}".strip() or user.get("username", "Gopi")

        text = raw_msg.get("text") or raw_msg.get("caption") or ""
        msg_id = str(raw_msg.get("message_id", ""))
        reply_to_id = str(raw_msg["reply_to_message"]["message_id"]) if "reply_to_message" in raw_msg else None

        # Extract Media
        media_items: List[MediaItem] = []
        if "photo" in raw_msg:
            photos = raw_msg["photo"]
            best_photo = photos[-1]  # Highest resolution
            media_items.append(MediaItem(
                type="photo",
                file_id=best_photo["file_id"],
                file_unique_id=best_photo.get("file_unique_id"),
                file_size=best_photo.get("file_size"),
                caption=raw_msg.get("caption"),
            ))
        elif "voice" in raw_msg:
            v = raw_msg["voice"]
            media_items.append(MediaItem(
                type="voice",
                file_id=v["file_id"],
                mime_type=v.get("mime_type"),
                file_size=v.get("file_size"),
            ))
        elif "document" in raw_msg:
            d = raw_msg["document"]
            media_items.append(MediaItem(
                type="document",
                file_id=d["file_id"],
                file_name=d.get("file_name"),
                mime_type=d.get("mime_type"),
                file_size=d.get("file_size"),
            ))

        is_cmd = text.startswith("/")
        cmd_name = text.split()[0].lower() if is_cmd else None
        cmd_args = text[len(cmd_name):].strip() if is_cmd and cmd_name else ""

        parsed_msg = TelegramMessage(
            message_id=msg_id,
            chat_id=chat_id,
            chat_type=chat_type,
            user_id=user_id,
            user_name=display_name,
            text=text,
            media=media_items,
            reply_to_message_id=reply_to_id,
            is_command=is_cmd,
            command=cmd_name,
            args=cmd_args,
        )

        # Notify AG UI Protocol
        await ag_ui_bridge.emit(
            AGUIEventType.TRANSCRIPT,
            {"content": text, "role": "user", "chat_id": chat_id, "platform": "telegram"}
        )

        # Add to batcher
        await self._batcher.add(chat_id, parsed_msg)

    async def _on_batch_received(self, chat_id: str, messages: List[TelegramMessage]):
        """
        Executed when batch window closes:
        1. Activates typing indicator in Telegram (with 4s refresh loop)
        2. Dispatches to FridayBrain
        3. Formats & sends response in chunks
        4. Logs to session transcript
        """
        if not messages:
            return

        first = messages[0]
        session = self._get_or_create_session(
            chat_id=chat_id,
            chat_type=first.chat_type,
            display_name=first.user_name,
            user_id=first.user_id,
        )

        # Merge texts for rapid message bursts
        combined_text = "\n".join(m.text for m in messages if m.text).strip()
        composite_msg = TelegramMessage(
            message_id=first.message_id,
            chat_id=chat_id,
            chat_type=first.chat_type,
            user_id=first.user_id,
            user_name=first.user_name,
            text=combined_text,
            media=[item for m in messages for item in m.media],
            reply_to_message_id=first.reply_to_message_id,
            is_command=first.is_command,
            command=first.command,
            args=first.args,
        )

        self._save_message(session.session_id, "user", combined_text, first.message_id)

        # 1. Engage Continuous Real-Time Typing Indicator
        async with self._typing.typing(chat_id, action=ChatAction.TYPING.value):
            await ag_ui_bridge.emit_typing(chat_id, active=True)
            await ag_ui_bridge.emit_agent_state("thinking", agent="friday")

            try:
                # 2. Process with Multi-Agent Brain
                reply_text, img_path = await self._brain.process_message(composite_msg)
            except Exception as e:
                log.error(f"Brain execution error for chat {chat_id}: {e}", exc_info=True)
                reply_text = f"❌ <b>Execution Notice</b>: {e}"
                img_path = None

            await ag_ui_bridge.emit_typing(chat_id, active=False)
            await ag_ui_bridge.emit_agent_state("speaking", agent="friday")

        # 3. Deliver Outbound Reply (Photo or Text)
        if img_path and os.path.exists(img_path):
            await self.send_photo(
                chat_id=chat_id,
                photo_path=img_path,
                caption=reply_text,
                session_id=session.session_id,
                reply_to_message_id=first.message_id if len(messages) == 1 else None
            )
        else:
            await self.send_message(
                chat_id=chat_id,
                text=reply_text,
                session_id=session.session_id,
                reply_to_message_id=first.message_id if len(messages) == 1 else None
            )

        await ag_ui_bridge.emit_agent_state("idle", agent="friday")

    # ── Outbound Send Pipeline ────────────────────────────────────────

    async def send_message(
        self,
        chat_id: str,
        text: str,
        session_id: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
        parse_mode: str = "HTML",
    ) -> SendResult:
        """
        Deliver message with Markdown->HTML conversion, chunk splitting,
        flood backoff handling, and delivery ledger fallback.
        """
        if not text:
            return SendResult(success=True)

        session_key = self._format_session_key(chat_id, "dm")

        # 1. Format Markdown to safe Telegram HTML
        html_formatted = markdown_to_telegram_html(text) if parse_mode == "HTML" else text
        chunks = chunk_message(html_formatted, limit=MAX_MSG_UTF16)

        last_msg_id = None
        chunks_sent = 0

        for i, chunk in enumerate(chunks):
            # Check flood limits
            if self._flood.is_flooded(chat_id):
                wait = self._flood.wait_remaining(chat_id)
                if wait > FLOOD_INLINE_CAP:
                    log.warning(f"Chat {chat_id} is flooded (> {FLOOD_INLINE_CAP}s wait). Holding chunk in delivery ledger.")
                    self._ledger.hold(session_key, chunk, {"chat_id": chat_id, "reply_to": reply_to_message_id})
                    continue
                await asyncio.sleep(wait)

            payload: Dict[str, Any] = {
                "chat_id": str(chat_id),
                "text": chunk,
                "parse_mode": parse_mode,
            }
            if reply_to_message_id and i == 0:
                payload["reply_to_message_id"] = int(reply_to_message_id)

            try:
                if not self._client:
                    raise RuntimeError("HTTP client offline")

                resp = await self._client.post("/sendMessage", json=payload, timeout=25.0)
                data = resp.json()

                if data.get("ok"):
                    last_msg_id = str(data["result"]["message_id"])
                    chunks_sent += 1
                    if session_id:
                        self._save_message(session_id, "assistant", chunk, last_msg_id)
                    await ag_ui_bridge.emit(
                        AGUIEventType.TRANSCRIPT,
                        {"content": chunk, "role": "assistant", "chat_id": chat_id, "platform": "telegram"}
                    )
                else:
                    err_desc = data.get("description", "Unknown Telegram send error")
                    params = data.get("parameters", {})
                    retry_after = params.get("retry_after")
                    if retry_after:
                        self._flood.record_flood(chat_id, float(retry_after))

                    # If HTML parsing failed, fallback to plain text
                    if "can't parse" in err_desc.lower() or "entity" in err_desc.lower():
                        log.warning("HTML parsing rejected by Telegram. Retrying chunk in plain text...")
                        payload.pop("parse_mode", None)
                        retry_resp = await self._client.post("/sendMessage", json=payload, timeout=25.0)
                        r_data = retry_resp.json()
                        if r_data.get("ok"):
                            last_msg_id = str(r_data["result"]["message_id"])
                            chunks_sent += 1
                            if session_id:
                                self._save_message(session_id, "assistant", chunk, last_msg_id)
                            continue

                    log.warning(f"Telegram sendMessage failed: {err_desc}. Queueing to delivery ledger.")
                    self._ledger.hold(session_key, chunk, {"chat_id": chat_id, "reply_to": reply_to_message_id})

            except Exception as e:
                log.warning(f"Network error during sendMessage ({e}). Queueing to delivery ledger.")
                self._ledger.hold(session_key, chunk, {"chat_id": chat_id, "reply_to": reply_to_message_id})

        return SendResult(
            success=chunks_sent > 0,
            message_id=last_msg_id,
            chunks_sent=chunks_sent,
        )

    async def send_photo(
        self,
        chat_id: str,
        photo_path: str,
        caption: Optional[str] = None,
        session_id: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
    ) -> SendResult:
        """Upload and deliver a photo/screenshot to Telegram chat."""
        if not self._client or not os.path.exists(photo_path):
            return SendResult(success=False, error="File not found or client offline")

        try:
            with open(photo_path, "rb") as f:
                photo_bytes = f.read()

            files = {
                "photo": (Path(photo_path).name, photo_bytes, "image/png"),
            }
            data: Dict[str, Any] = {
                "chat_id": str(chat_id),
            }
            if caption:
                data["caption"] = markdown_to_telegram_html(caption)[:1024]
                data["parse_mode"] = "HTML"
            if reply_to_message_id:
                data["reply_to_message_id"] = int(reply_to_message_id)

            resp = await self._client.post(
                "/sendPhoto",
                data=data,
                files=files,
                timeout=35.0,
            )
            r_json = resp.json()
            if r_json.get("ok"):
                msg_id = str(r_json["result"]["message_id"])
                if session_id:
                    self._save_message(session_id, "assistant", f"[Photo: {caption or 'Screenshot'}]", msg_id)
                return SendResult(success=True, message_id=msg_id)
            else:
                err = r_json.get("description", "Failed to upload photo")
                log.warning(f"sendPhoto failed: {err}")
                return SendResult(success=False, error=err)
        except Exception as e:
            log.warning(f"Error in send_photo: {e}")
            return SendResult(success=False, error=str(e))

    # ── Gap Recovery & Ledger Flush ───────────────────────────────────

    async def _periodic_ledger_flush(self):
        """Flushes undelivered ledger items every 60 seconds when network is restored."""
        while self._running:
            try:
                await asyncio.sleep(60.0)
                undelivered = self._ledger.get_undelivered()
                for item in undelivered:
                    chat_id = item.metadata.get("chat_id") or self._allowed_chat_id
                    if not chat_id:
                        continue
                    if self._flood.is_flooded(chat_id):
                        continue

                    if not self._client:
                        continue
                    try:
                        resp = await self._client.post(
                            "/sendMessage",
                            json={"chat_id": str(chat_id), "text": item.content, "parse_mode": "HTML"},
                            timeout=20.0,
                        )
                        if resp.json().get("ok"):
                            self._ledger.mark_delivered(item.id or 0)
                            log.info(f"Delivered previously held ledger message #{item.id}")
                        else:
                            self._ledger.record_attempt(item.id or 0, resp.json().get("description"))
                    except Exception as e:
                        self._ledger.record_attempt(item.id or 0, str(e))
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.debug(f"Ledger flush note: {e}")

    # ── Lifecycle ─────────────────────────────────────────────────────

    async def stop(self):
        """Gracefully stop polling and close all connections."""
        log.info("Stopping Friday-OS Telegram Channel Gateway...")
        self._running = False

        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
        if self._ledger_flush_task and not self._ledger_flush_task.done():
            self._ledger_flush_task.cancel()

        await self._typing.stop_all()
        await self._batcher.flush_all()

        if self._client:
            await self._client.aclose()
            self._client = None

        log.info("Friday-OS Telegram Channel Gateway stopped.")
