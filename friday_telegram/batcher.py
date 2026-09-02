"""
Friday-OS — Telegram Message Batcher
Batches rapid burst messages and media albums before handing off to FridayBrain.
Mirrors Hermes adaptive text batching (180ms/240ms/400ms) and media grouping (800ms).
"""

import asyncio
import logging
from typing import Dict, List, Callable, Any, Optional
from .models import TelegramMessage

log = logging.getLogger("friday.telegram.batcher")

# Batching windows (seconds)
TEXT_BATCH_SHORT = 0.18    # < 320 chars
TEXT_BATCH_MED = 0.24      # < 1024 chars
TEXT_BATCH_LONG = 0.40     # >= 1024 chars
MEDIA_BATCH_WINDOW = 0.80  # Album / media burst


class MessageBatcher:
    """
    Batches rapid incoming messages per chat/session to avoid fragmentation
    and prevent redundant tool/brain invocations.
    """

    def __init__(self, on_batch: Callable[[str, List[TelegramMessage]], Any]):
        self._on_batch = on_batch
        self._pending: Dict[str, List[TelegramMessage]] = {}
        self._tasks: Dict[str, asyncio.Task] = {}
        self._media_groups: Dict[str, List[TelegramMessage]] = {}

    def _compute_delay(self, msg: TelegramMessage) -> float:
        """Adaptive debounce delay based on message length and media presence."""
        if msg.media:
            return MEDIA_BATCH_WINDOW
        n = len(msg.text or "")
        if n <= 320:
            return TEXT_BATCH_SHORT
        if n <= 1024:
            return TEXT_BATCH_MED
        return TEXT_BATCH_LONG

    async def add(self, chat_id: str, msg: TelegramMessage):
        """Add message to chat queue and schedule/extend flush debounce window."""
        self._pending.setdefault(chat_id, []).append(msg)

        # Cancel existing timer to extend debounce window
        existing_task = self._tasks.get(chat_id)
        if existing_task and not existing_task.done():
            existing_task.cancel()

        delay = self._compute_delay(msg)
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._flush_after(chat_id, delay))
        self._tasks[chat_id] = task

    async def _flush_after(self, chat_id: str, delay: float):
        """Wait for debounce window to expire, then deliver the batch."""
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return

        batch = self._pending.pop(chat_id, [])
        self._tasks.pop(chat_id, None)

        if not batch:
            return

        try:
            # If batch has callback, execute it
            res = self._on_batch(chat_id, batch)
            if asyncio.iscoroutine(res):
                await res
        except Exception as e:
            log.error(f"Error executing on_batch callback for chat {chat_id}: {e}", exc_info=True)

    async def flush_all(self):
        """Immediately flush all pending message batches (for shutdown)."""
        chat_ids = list(self._pending.keys())
        for cid in chat_ids:
            task = self._tasks.pop(cid, None)
            if task and not task.done():
                task.cancel()
            batch = self._pending.pop(cid, [])
            if batch:
                try:
                    res = self._on_batch(cid, batch)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception as e:
                    log.error(f"Flush error for chat {cid}: {e}")
