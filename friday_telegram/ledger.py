"""
Friday-OS — Telegram Delivery Ledger
Holds outbound messages during network disconnects or flood waits.
Ensures zero message drops across restarts and connection interruptions.
"""

import json
import time
import sqlite3
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from .models import DeliveryItem

log = logging.getLogger("friday.telegram.ledger")


class DeliveryLedger:
    """
    SQLite-backed delivery ledger.
    Persists unsent messages with metadata and delivery retry states.
    """

    def __init__(self, db_path: str):
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.execute("""
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
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_ledger_undelivered 
                ON delivery_ledger(session_key, delivered_at)
            """)
            conn.commit()

    def hold(self, session_key: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> int:
        """Store undelivered message in ledger. Returns inserted row ID."""
        now = time.time()
        meta_json = json.dumps(metadata or {})
        with self._get_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO delivery_ledger (session_key, content, metadata, created_at, attempts)
                VALUES (?, ?, ?, ?, 0)
                """,
                (session_key, content, meta_json, now)
            )
            conn.commit()
            row_id = cur.lastrowid or 0
            log.info(f"Message held in delivery ledger [id={row_id}, session={session_key}]")
            return row_id

    def mark_delivered(self, row_id: int):
        """Mark ledger message as delivered with current timestamp."""
        now = time.time()
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE delivery_ledger SET delivered_at = ?, error = NULL WHERE id = ?",
                (now, row_id)
            )
            conn.commit()
            log.debug(f"Delivery ledger entry {row_id} marked delivered")

    def record_attempt(self, row_id: int, error: Optional[str] = None):
        """Increment attempt count and record last error message."""
        with self._get_conn() as conn:
            conn.execute(
                """
                UPDATE delivery_ledger 
                SET attempts = attempts + 1, error = ? 
                WHERE id = ?
                """,
                (error, row_id)
            )
            conn.commit()

    def get_undelivered(self, session_key: Optional[str] = None) -> List[DeliveryItem]:
        """Fetch all messages waiting for delivery."""
        with self._get_conn() as conn:
            if session_key:
                cur = conn.execute(
                    """
                    SELECT id, session_key, content, metadata, created_at, delivered_at, attempts, error
                    FROM delivery_ledger
                    WHERE session_key = ? AND delivered_at IS NULL
                    ORDER BY id ASC
                    """,
                    (session_key,)
                )
            else:
                cur = conn.execute(
                    """
                    SELECT id, session_key, content, metadata, created_at, delivered_at, attempts, error
                    FROM delivery_ledger
                    WHERE delivered_at IS NULL
                    ORDER BY id ASC
                    """
                )
            rows = cur.fetchall()

        items = []
        for r in rows:
            try:
                meta = json.loads(r["metadata"]) if r["metadata"] else {}
            except Exception:
                meta = {}
            items.append(DeliveryItem(
                id=r["id"],
                session_key=r["session_key"],
                content=r["content"],
                metadata=meta,
                created_at=r["created_at"],
                delivered_at=r["delivered_at"],
                attempts=r["attempts"],
                error=r["error"],
            ))
        return items

    def purge_old_delivered(self, max_age_days: int = 7):
        """Clean up delivered ledger records older than max_age_days."""
        cutoff = time.time() - (max_age_days * 86400)
        with self._get_conn() as conn:
            conn.execute(
                "DELETE FROM delivery_ledger WHERE delivered_at IS NOT NULL AND delivered_at < ?",
                (cutoff,)
            )
            conn.commit()
