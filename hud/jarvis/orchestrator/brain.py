"""
Brain — lightweight orchestrator for continuous listening.
Not the voice LLM (that's in Studio). This is the decision layer:
- Should we delegate to a specialist?
- Is this a memory write, a search, a tool, or just chatter?
- Proactive checks via cron

Reuses Hermes SOUL.md orchestrator pattern: delegate_task + cronjob + memory
"""

import re
from typing import Dict, Any, Optional, Tuple
from pathlib import Path

# heuristics for intent classification
MEMORY_WRITE_PATTERNS = [
    r"remember (that|this)",
    r"don't forget",
    r"save (this|that)",
    r"note (that|this)",
]

SEARCH_PATTERNS = [
    r"what did (we|you|i) (say|discuss|talk)",
    r"remember when",
    r"find .* (about|for)",
    r"search (for|my)",
]

DELEGATE_KEYWORDS = {
    "trading": ["trade", "portfolio", "rebalance", "p&l", "stock", "crypto"],
    "research": ["research", "paper", "analyze", "investigate", "deep dive"],
    "content": ["write", "blog", "youtube", "seo", "publish", "content"],
    "dev": ["build", "code", "deploy", "fix bug", "implement", "refactor"],
    "infra": ["server", "backup", "monitor", "vps", "deploy"],
}

def classify_intent(text: str) -> Dict[str, Any]:
    t = text.lower()
    intent = {"type": "chat", "confidence": 0.5, "delegate": None}

    # memory write?
    for pat in MEMORY_WRITE_PATTERNS:
        if re.search(pat, t):
            return {"type": "memory_write", "confidence": 0.9}

    # search?
    for pat in SEARCH_PATTERNS:
        if re.search(pat, t):
            return {"type": "memory_search", "confidence": 0.85, "query": text}

    # delegate?
    for agent, keywords in DELEGATE_KEYWORDS.items():
        for kw in keywords:
            if kw in t:
                return {"type": "delegate", "confidence": 0.8, "delegate": agent, "task": text}

    # tool-like?
    if any(k in t for k in ["run ", "execute", "file", "open", "show me", "list"]):
        return {"type": "tool", "confidence": 0.7}

    # chatter vs question
    if "?" in text or text.lower().startswith(("what", "how", "why", "can you", "could you")):
        return {"type": "question", "confidence": 0.7}

    return intent

def route_message(text: str, session_id: str = "continuous") -> Dict[str, Any]:
    """
    Called by stream_server after vault write.
    Returns routing decision + optional tool calls to execute.
    Studio can use this to decide whether to speak, delegate, or stay silent.
    """
    intent = classify_intent(text)
    actions = []

    if intent["type"] == "memory_write":
        actions.append({"tool": "write_memory", "arguments": {"content": text, "target": "memory"}})
    elif intent["type"] == "memory_search":
        actions.append({"tool": "search_memory", "arguments": {"query": intent.get("query", text), "limit": 10}})
    elif intent["type"] == "delegate":
        actions.append({"tool": "delegate_task", "arguments": {"task": intent["task"], "agent": intent["delegate"]}})
    elif intent["type"] == "question":
        # RAG search before answering
        actions.append({"tool": "search_memory", "arguments": {"query": text, "limit": 5}})

    return {
        "intent": intent,
        "actions": actions,
        "should_speak": intent["type"] in ("question", "delegate", "memory_search"),
        "session_id": session_id,
    }

# ---- proactive loop definitions (mirrors SOUL.md:107) ----
PROACTIVE_JOBS = [
    {"id": "morning_brief", "schedule": "0 6 * * *", "prompt": "Generate morning brief: overnight P&L, fleet health, calendar, anomalies"},
    {"id": "midday_review", "schedule": "0 12 * * *", "prompt": "Mid-day review: content performance, lead pipeline, infra alerts"},
    {"id": "evening_synthesis", "schedule": "0 20 * * *", "prompt": "Evening synthesis: what learned today, what improved, tomorrow priorities"},
    {"id": "vault_commit", "schedule": "*/5 * * * *", "prompt": "Commit Obsidian vault to git if changes"},
    {"id": "daily_synthesis", "schedule": "0 22 * * *", "prompt": "Synthesize today's Conversations into Daily-Logs via memory_manager.synthesize_daily"},
]

def get_proactive_jobs() -> list:
    return PROACTIVE_JOBS
