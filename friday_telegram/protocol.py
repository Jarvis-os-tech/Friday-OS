"""
Friday-OS — AG UI Protocol & Event Bridge
Defines standard Agentic UI (AG UI) protocol envelopes and bi-directional event bridging
between the Telegram Channel, Friday Prime Core, and the Friday Desktop/Web UI (WebSocket).
"""

import time
import uuid
import json
import asyncio
import logging
from enum import Enum
from typing import Dict, Any, Optional, List, Callable
from dataclasses import dataclass, field, asdict

log = logging.getLogger("friday.telegram.protocol")


class AGUIEventType(str, Enum):
    """Canonical AG UI event types for UI state and streaming synchronization."""
    AGENT_STATE = "ag_ui:agent_state"
    TYPING = "ag_ui:typing"
    TOOL_CALL = "ag_ui:tool_call"
    TOOL_RESULT = "ag_ui:tool_result"
    TASK_STARTED = "ag_ui:task_started"
    TASK_PROGRESS = "ag_ui:task_progress"
    TASK_COMPLETED = "ag_ui:task_completed"
    TASK_FAILED = "ag_ui:task_failed"
    DISPLAY_CARD = "ag_ui:display_card"
    TRANSCRIPT = "ag_ui:transcript"
    TELEMETRY = "ag_ui:telemetry"


@dataclass
class AGUIEvent:
    """Envelope for all AG UI protocol messages."""
    event_type: str
    payload: Dict[str, Any]
    id: str = field(default_factory=lambda: f"ag_{uuid.uuid4().hex[:8]}")
    timestamp: float = field(default_factory=time.time)
    source: str = "friday_telegram"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.event_type,
            "timestamp": self.timestamp,
            "source": self.source,
            "payload": self.payload,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


class AGUIProtocolBridge:
    """
    Central AG UI Protocol bridge for Friday-OS.
    Synchronizes agent status, typing indicators, tool execution, and display cards
    across Telegram, local memory, and Friday OS UI WebSockets.
    """

    _instance: Optional["AGUIProtocolBridge"] = None

    @classmethod
    def get_instance(cls) -> "AGUIProtocolBridge":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self, ws_url: str = "ws://127.0.0.1:3000"):
        self._ws_url = ws_url
        self._subscribers: List[Callable[[AGUIEvent], Any]] = []
        self._ws_client = None
        self._running = False
        self._reconnect_task: Optional[asyncio.Task] = None

    def subscribe(self, callback: Callable[[AGUIEvent], Any]):
        """Subscribe local handler to AG UI protocol events."""
        if callback not in self._subscribers:
            self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[AGUIEvent], Any]):
        """Unsubscribe handler."""
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    async def emit(self, event_type: str | AGUIEventType, payload: Dict[str, Any], source: str = "friday_telegram") -> AGUIEvent:
        """Emit an AG UI event to all local subscribers and external UI WebSocket."""
        t_str = event_type.value if isinstance(event_type, AGUIEventType) else str(event_type)
        event = AGUIEvent(event_type=t_str, payload=payload, source=source)
        
        # 1. Dispatch to local subscribers
        for sub in list(self._subscribers):
            try:
                res = sub(event)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                log.debug(f"Subscriber error on {t_str}: {e}")

        # 2. Forward to Friday OS WebSocket if connected
        if self._ws_client:
            try:
                # Map to standard Friday UI websocket schema
                ui_msg = self._map_to_ui_schema(event)
                if ui_msg:
                    await self._ws_client.send(json.dumps(ui_msg))
            except Exception as e:
                log.debug(f"Failed to forward event to UI WebSocket: {e}")

        return event

    def _map_to_ui_schema(self, event: AGUIEvent) -> Optional[Dict[str, Any]]:
        """Translate AG UI events into Friday Web/Desktop UI message formats."""
        p = event.payload
        t = event.event_type

        now_ms = int(time.time() * 1000)
        if t == AGUIEventType.AGENT_STATE.value:
            return {"type": "status", "status": p.get("status", "idle"), "agent": p.get("agent", "friday")}
        elif t == AGUIEventType.TASK_STARTED.value:
            return {"type": "task_started", "taskId": p.get("task_id"), "task": p.get("task", p), "timestamp": now_ms}
        elif t == AGUIEventType.TASK_PROGRESS.value:
            return {"type": "task_progress", "taskId": p.get("task_id"), "progressMessage": p.get("progress_message"), "progressPercent": p.get("progress_percent"), "timestamp": now_ms}
        elif t == AGUIEventType.TASK_COMPLETED.value:
            return {"type": "task_completed", "taskId": p.get("task_id"), "task": p.get("task"), "displayCard": p.get("display_card"), "result": p.get("result"), "speechSummary": p.get("speech_summary"), "durationMs": p.get("duration_ms"), "timestamp": now_ms}
        elif t == AGUIEventType.TASK_FAILED.value:
            return {"type": "task_failed", "taskId": p.get("task_id"), "task": p.get("task"), "error": p.get("error"), "timestamp": now_ms}
        elif t == AGUIEventType.DISPLAY_CARD.value:
            return {"type": "skill_executed", "result": {"displayCard": p.get("display_card")}}
        elif t == AGUIEventType.TRANSCRIPT.value:
            return {"type": "transcript", "text": p.get("content", ""), "role": p.get("role", "agent"), "timestamp": int(time.time() * 1000)}
        return {"type": "ag_ui_event", "event": event.to_dict()}

    # ── Convenient Helper Dispatchers ─────────────────────────────────

    async def emit_agent_state(self, status: str, agent: str = "friday", details: Optional[Dict[str, Any]] = None):
        """Emit agent status change (e.g. thinking, speaking, executing_tool, idle)."""
        await self.emit(
            AGUIEventType.AGENT_STATE,
            {"status": status, "agent": agent, "details": details or {}}
        )

    async def emit_typing(self, chat_id: str, active: bool = True, platform: str = "telegram"):
        """Emit typing indicator status."""
        await self.emit(
            AGUIEventType.TYPING,
            {"chat_id": str(chat_id), "active": active, "platform": platform}
        )

    async def emit_tool_call(self, tool_name: str, parameters: Dict[str, Any], call_id: Optional[str] = None):
        """Emit tool invocation event."""
        await self.emit(
            AGUIEventType.TOOL_CALL,
            {"tool_name": tool_name, "parameters": parameters, "call_id": call_id or uuid.uuid4().hex[:6]}
        )

    async def emit_tool_result(self, tool_name: str, result: Any, success: bool = True, duration_ms: float = 0.0):
        """Emit tool result event."""
        await self.emit(
            AGUIEventType.TOOL_RESULT,
            {"tool_name": tool_name, "result": result, "success": success, "duration_ms": duration_ms}
        )

    async def emit_task_started(self, task_id: str, title: str, category: str, prompt: Optional[str] = None, verbal_ack: Optional[str] = None):
        """Emit background/specialist task start event."""
        task_data = {
            "id": task_id,
            "type": category,
            "title": title,
            "prompt": prompt,
            "status": "running",
            "startTime": int(time.time() * 1000),
            "progressPercent": 10,
            "progressMessage": "Executing task...",
            "verbalAcknowledgment": verbal_ack,
        }
        await self.emit(
            AGUIEventType.TASK_STARTED,
            {"task_id": task_id, "task": task_data}
        )

    async def emit_task_progress(self, task_id: str, message: str, percent: Optional[int] = None):
        """Emit task progress update."""
        await self.emit(
            AGUIEventType.TASK_PROGRESS,
            {"task_id": task_id, "progress_message": message, "progress_percent": percent}
        )

    async def emit_task_completed(self, task_id: str, result: Any, display_card: Optional[Dict[str, Any]] = None, speech_summary: Optional[str] = None, duration_ms: float = 0.0):
        """Emit task completion event with optional SkillDisplayCard."""
        await self.emit(
            AGUIEventType.TASK_COMPLETED,
            {
                "task_id": task_id,
                "result": result,
                "display_card": display_card,
                "speech_summary": speech_summary,
                "duration_ms": duration_ms,
            }
        )

    async def emit_display_card(self, card_type: str, title: str, data: Dict[str, Any]):
        """Emit a SkillDisplayCard for rich UI rendering."""
        card = {"type": card_type, "title": title, "data": data}
        await self.emit(AGUIEventType.DISPLAY_CARD, {"display_card": card})


# Global singleton instance
ag_ui_bridge = AGUIProtocolBridge.get_instance()
