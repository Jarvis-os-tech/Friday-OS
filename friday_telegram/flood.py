"""
Friday-OS — Telegram Flood Controller
Tracks per-chat RetryAfter responses from Telegram API.
Enforces inline backoff when wait <= FLOOD_INLINE_CAP (5.0s),
and queues to DeliveryLedger when wait exceeds inline cap.
"""

import time
import logging
from typing import Dict

log = logging.getLogger("friday.telegram.flood")

# Maximum time (seconds) to wait inline before queueing to delivery ledger
FLOOD_INLINE_CAP = 5.0


class FloodController:
    """Tracks per-chat rate limiting and flood control deadlines."""

    def __init__(self):
        self._retry_until: Dict[str, float] = {}

    def record_flood(self, chat_id: str, retry_after: float):
        """Record a 429 / RetryAfter penalty for a chat."""
        deadline = time.monotonic() + float(retry_after)
        self._retry_until[str(chat_id)] = deadline
        log.warning(f"Telegram flood limit for chat {chat_id}: RetryAfter {retry_after}s")

    def is_flooded(self, chat_id: str) -> bool:
        """Check if chat is currently in flood cooldown."""
        deadline = self._retry_until.get(str(chat_id), 0.0)
        return time.monotonic() < deadline

    def wait_remaining(self, chat_id: str) -> float:
        """Seconds remaining before chat flood restriction lifts."""
        deadline = self._retry_until.get(str(chat_id), 0.0)
        remaining = deadline - time.monotonic()
        return max(0.0, remaining)

    def should_wait_inline(self, chat_id: str) -> bool:
        """Return True if flood delay is small enough (<= 5s) to wait inline."""
        wait = self.wait_remaining(chat_id)
        return 0.0 < wait <= FLOOD_INLINE_CAP
