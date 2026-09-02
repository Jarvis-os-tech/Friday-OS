"""
Friday-OS — Telegram Typing Indicator Controller
Provides real-time typing indicators in Telegram chats during AI reasoning,
tool execution, and multi-agent task delegations.

Telegram's sendChatAction indicator lasts ~5 seconds.
This controller sends an immediate typing action, then refreshes every 4.0 seconds
until response generation completes.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Dict, Optional, Callable, Awaitable
import httpx
from .models import ChatAction

log = logging.getLogger("friday.telegram.typing")

TYPING_REFRESH_INTERVAL = 4.0  # seconds (Telegram status expires at ~5.0s)


class TypingController:
    """
    Manages active typing indicators across Telegram chats.
    Supports single-shot triggers, background loops, and async context managers.
    """

    def __init__(self, client_factory: Callable[[], Optional[httpx.AsyncClient]]):
        self._get_client = client_factory
        self._active_tasks: Dict[str, asyncio.Task] = {}
        self._active_refcounts: Dict[str, int] = {}

    async def send_action(self, chat_id: str, action: str = ChatAction.TYPING.value) -> bool:
        """Send a single sendChatAction request to Telegram."""
        client = self._get_client()
        if not client:
            return False

        try:
            resp = await client.post(
                "/sendChatAction",
                json={"chat_id": str(chat_id), "action": action},
                timeout=10.0,
            )
            data = resp.json()
            return bool(data.get("ok"))
        except Exception as e:
            log.debug(f"sendChatAction failed for chat {chat_id}: {e}")
            return False

    async def _typing_loop(self, chat_id: str, action: str = ChatAction.TYPING.value):
        """Continuous typing indicator loop that refreshes every 4 seconds."""
        try:
            while True:
                await self.send_action(chat_id, action)
                await asyncio.sleep(TYPING_REFRESH_INTERVAL)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.debug(f"Typing loop exited with exception for {chat_id}: {e}")

    def start_typing(self, chat_id: str, action: str = ChatAction.TYPING.value):
        """Start recurring typing indicator for a chat."""
        cid = str(chat_id)
        current_count = self._active_refcounts.get(cid, 0)
        self._active_refcounts[cid] = current_count + 1

        if cid not in self._active_tasks or self._active_tasks[cid].done():
            loop = asyncio.get_running_loop()
            self._active_tasks[cid] = loop.create_task(self._typing_loop(cid, action))
            log.debug(f"Started continuous typing indicator for chat {cid}")

    def stop_typing(self, chat_id: str):
        """Stop recurring typing indicator for a chat (decrements refcount)."""
        cid = str(chat_id)
        current_count = self._active_refcounts.get(cid, 1) - 1
        if current_count <= 0:
            self._active_refcounts.pop(cid, None)
            task = self._active_tasks.pop(cid, None)
            if task and not task.done():
                task.cancel()
                log.debug(f"Stopped typing indicator for chat {cid}")
        else:
            self._active_refcounts[cid] = current_count

    @asynccontextmanager
    async def typing(self, chat_id: str, action: str = ChatAction.TYPING.value):
        """
        Async context manager for typing status.
        Ensures typing is active throughout code execution and cleaned up on exit.
        
        Example:
            async with typing_controller.typing(chat_id):
                response = await brain.generate_response(prompt)
        """
        self.start_typing(chat_id, action)
        try:
            yield
        finally:
            self.stop_typing(chat_id)

    async def stop_all(self):
        """Cancel all running typing loops."""
        for cid, task in list(self._active_tasks.items()):
            if not task.done():
                task.cancel()
        self._active_tasks.clear()
        self._active_refcounts.clear()
