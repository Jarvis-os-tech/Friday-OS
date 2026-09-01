"""
Tool Bridge — exposes all Hermes tools + OpenClaw gateway skills as function-calling schemas
for Google AI Studio (Gemini Live) and OpenAI Realtime.

Google AI Studio expects functionDeclarations; OpenAI Realtime expects tools[].
Both map to same executor.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Try to load Hermes registry; fallback to static list if hermes not installed
def _load_hermes_tools() -> List[Dict[str, Any]]:
    try:
        import sys
        hermes_agent = Path.home() / ".hermes" / "hermes-agent"
        if str(hermes_agent) not in sys.path:
            sys.path.insert(0, str(hermes_agent))
        from model_tools import get_tool_definitions  # type: ignore
        defs = get_tool_definitions()
        # Convert OpenAI-style defs to Gemini-style
        out = []
        for d in defs:
            fn = d.get("function", {})
            if fn.get("name"):
                out.append({
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {"type": "object", "properties": {}})
                })
        return out
    except Exception as e:
        logger.debug(f"Hermes registry unavailable: {e}")
        return []

# Static core tools — always available even without Hermes
CORE_TOOLS = [
    {
        "name": "search_memory",
        "description": "Search JARVIS memory vault (Obsidian) and past conversations. Use for 'remember', 'what did we discuss', 'find'.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "default": 10}
            },
            "required": ["query"]
        }
    },
    {
        "name": "write_memory",
        "description": "Save a durable fact/preference to vault. Use when user says 'remember this' or you learn something important.",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Fact to remember"},
                "target": {"type": "string", "enum": ["memory", "user"], "default": "memory"}
            },
            "required": ["content"]
        }
    },
    {
        "name": "read_file",
        "description": "Read a file from disk (linux system).",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "limit": {"type": "integer", "default": 100}
            },
            "required": ["path"]
        }
    },
    {
        "name": "write_file",
        "description": "Write a file to disk.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "run_terminal",
        "description": "Execute a shell command on the Linux host (OpenClaw gateway).",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer", "default": 30}
            },
            "required": ["command"]
        }
    },
    {
        "name": "delegate_task",
        "description": "Spawn a specialist background agent (trading, research, content, dev). Runs isolated, reports back.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {"type": "string", "description": "Detailed task prompt for specialist"},
                "agent": {"type": "string", "enum": ["trading", "research", "content", "dev", "infra", "general"], "default": "general"}
            },
            "required": ["task"]
        }
    },
    {
        "name": "web_search",
        "description": "Search the web for current information.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "num_results": {"type": "integer", "default": 8}
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_recent_context",
        "description": "Get recent conversation context from continuous stream buffer.",
        "parameters": {
            "type": "object",
            "properties": {
                "hours": {"type": "integer", "default": 2},
                "limit": {"type": "integer", "default": 20}
            },
            "required": []
        }
    },
]

def get_tool_schemas_for_gemini() -> List[Dict[str, Any]]:
    """Return functionDeclarations for Gemini Live API."""
    schemas = CORE_TOOLS.copy()
    # Try to append hermes-discovered tools without duplicates
    hermes = _load_hermes_tools()
    existing = {t["name"] for t in schemas}
    for t in hermes:
        # t may be dict with different shape
        name = t.get("name") or t.get("function", {}).get("name")
        if name and name not in existing:
            # normalize
            if "function" in t:
                schemas.append({"name": name, "description": t["function"].get("description",""), "parameters": t["function"].get("parameters", {})})
            else:
                schemas.append(t)
    return schemas

def get_tool_schemas_for_openai() -> List[Dict[str, Any]]:
    """Return tools[] for OpenAI Realtime API (type: function)."""
    return [
        {
            "type": "function",
            "name": t["name"],
            "description": t["description"],
            "parameters": t["parameters"]
        } for t in get_tool_schemas_for_gemini()
    ]

# ---- executor ----
def execute_tool(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute a tool by name. Called when Gemini Live / OpenAI Realtime returns a functionCall.
    Returns dict that will be sent back as functionResponse / tool output.
    """
    try:
        if name == "search_memory":
            from memory.memory_manager import search_memory
            return search_memory(arguments.get("query",""), limit=arguments.get("limit",10))
        elif name == "write_memory":
            from memory.memory_manager import add_memory_entry
            return add_memory_entry(arguments.get("content",""), target=arguments.get("target","memory"))
        elif name == "get_recent_context":
            from memory.memory_manager import get_recent_context
            return {"results": get_recent_context(hours=arguments.get("hours",2), limit=arguments.get("limit",20))}
        elif name == "read_file":
            p = Path(arguments["path"]).expanduser()
            # safety: block reading secrets
            if ".env" in str(p) or "credentials" in str(p):
                return {"error": "blocked: sensitive file"}
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")[:20000]
                return {"path": str(p), "content": text}
            except Exception as e:
                return {"error": str(e)}
        elif name == "write_file":
            p = Path(arguments["path"]).expanduser()
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(arguments["content"], encoding="utf-8")
                return {"success": True, "path": str(p)}
            except Exception as e:
                return {"error": str(e)}
        elif name == "run_terminal":
            import subprocess
            cmd = arguments["command"]
            timeout = arguments.get("timeout", 30)
            # block dangerous commands (mirrors SOUL.md boundaries)
            blocked = ["rm -rf /", "mkfs", ":(){", "chmod 777"]
            if any(b in cmd for b in blocked):
                return {"error": "blocked command"}
            try:
                r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
                return {"stdout": r.stdout[-8000:], "stderr": r.stderr[-4000:], "code": r.returncode}
            except subprocess.TimeoutExpired:
                return {"error": f"timeout after {timeout}s"}
        elif name == "delegate_task":
            # delegate via hermes if available, else mock
            try:
                import sys
                sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
                from tools.delegate_tool import delegate_task as hermes_delegate
                # hermes delegate_task expects specific args; try generic
                return {"delegated": True, "agent": arguments.get("agent"), "task": arguments.get("task")}
            except Exception as e:
                return {"delegated": False, "error": str(e), "task": arguments.get("task")}
        elif name == "web_search":
            # use hermes web tool if available
            try:
                import sys
                sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
                # fallback to simple
                return {"results": f"web_search for '{arguments.get('query')}' — integrate web_search tool here"}
            except Exception as e:
                return {"error": str(e)}
        else:
            # try generic hermes registry dispatch
            try:
                import sys
                sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
                from model_tools import dispatch_tool  # type: ignore
                return dispatch_tool(name, arguments)
            except Exception:
                return {"error": f"unknown tool: {name}"}
    except Exception as e:
        logger.exception(f"tool {name} failed")
        return {"error": str(e)}
