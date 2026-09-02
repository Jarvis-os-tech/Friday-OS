"""
Friday-OS — Telegram Channel Models & Types
Canonical data structures for messages, sessions, delivery ledger, and chat actions.
"""

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ChatAction(str, Enum):
    """Telegram Chat Action types for typing and activity indicators."""
    TYPING = "typing"
    UPLOAD_PHOTO = "upload_photo"
    RECORD_VIDEO = "record_video"
    UPLOAD_VIDEO = "upload_video"
    RECORD_VOICE = "record_voice"
    UPLOAD_VOICE = "upload_voice"
    UPLOAD_DOCUMENT = "upload_document"
    CHOOSE_STICKER = "choose_sticker"
    FIND_LOCATION = "find_location"
    RECORD_VIDEO_NOTE = "record_video_note"
    UPLOAD_VIDEO_NOTE = "upload_video_note"


@dataclass
class MediaItem:
    """Attached media item in a Telegram message."""
    type: str  # photo | video | audio | voice | document | sticker
    file_id: str
    file_unique_id: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    file_name: Optional[str] = None


@dataclass
class TelegramMessage:
    """Parsed inbound Telegram message."""
    message_id: str
    chat_id: str
    chat_type: str  # dm | group | supergroup
    user_id: str
    user_name: str
    text: str
    media: List[MediaItem] = field(default_factory=list)
    thread_id: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    reply_to_message_id: Optional[str] = None
    is_command: bool = False
    command: Optional[str] = None
    args: str = ""


@dataclass
class FridaySession:
    """Durable conversation session mapped to a Telegram chat."""
    session_key: str  # "friday:telegram:dm:{chat_id}"
    session_id: str   # "YYYYMMDD_HHMMSS_{hex6}"
    chat_id: str
    chat_type: str
    display_name: str
    started_at: float = field(default_factory=time.time)
    ended_at: Optional[float] = None
    model: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    resume_pending: bool = False
    last_activity_at: float = field(default_factory=time.time)
    messages: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class SendResult:
    """Result of an outbound Telegram send attempt."""
    success: bool
    message_id: Optional[str] = None
    error: Optional[str] = None
    retry_after: Optional[float] = None
    chunks_sent: int = 1


@dataclass
class DeliveryItem:
    """Entry stored in the delivery ledger for offline/gap recovery."""
    id: Optional[int]
    session_key: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    delivered_at: Optional[float] = None
    attempts: int = 0
    error: Optional[str] = None
