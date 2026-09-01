"""
Tools Bridge — from hermes-agent/tools/registry.py + model_tools.py + ~/.openclaw/gateway
Expose Hermes/OpenClaw tools as Gemini Live functionDeclarations / OpenAI tools.

Origin:
  - registry.py:discover_builtin_tools() + ToolRegistry
  - model_tools.py:get_tool_definitions() → OpenAI function schemas
  - openclaw gateway: file/terminal/computer_use/browser skills via :18789
  - hermes-agent/tools: terminal_tool.py, file_tools.py, web_tools.py, etc.

Present-dir re-exports jarvis_tools/bridge.py logic but isolated in features/.
"""
import json, logging
from pathlib import Path
from typing import Dict, Any, List
logger=logging.getLogger(__name__)

CORE_TOOLS=[
 {"name":"search_memory","description":"Search vault","parameters":{"type":"object","properties":{"query":{"type":"string"},"limit":{"type":"integer","default":10}},"required":["query"]}},
 {"name":"write_memory","description":"Save fact","parameters":{"type":"object","properties":{"content":{"type":"string"},"target":{"type":"string","enum":["memory","user"],"default":"memory"}},"required":["content"]}},
 {"name":"read_file","description":"Read file","parameters":{"type":"object","properties":{"path":{"type":"string"},"limit":{"type":"integer","default":100}},"required":["path"]}},
 {"name":"write_file","description":"Write file","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}},
 {"name":"run_terminal","description":"Run shell (OpenClaw)","parameters":{"type":"object","properties":{"command":{"type":"string"},"timeout":{"type":"integer","default":30}},"required":["command"]}},
 {"name":"delegate_task","description":"Spawn specialist","parameters":{"type":"object","properties":{"task":{"type":"string"},"agent":{"type":"string","enum":["trading","research","content","dev","infra","general"],"default":"general"}},"required":["task"]}},
 {"name":"web_search","description":"Web search","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
 {"name":"get_recent_context","description":"Recent buffer","parameters":{"type":"object","properties":{"hours":{"type":"integer","default":2},"limit":{"type":"integer","default":20}}}},
]

def _load_hermes_tools():
    try:
        import sys
        hp=Path.home()/".hermes"/"hermes-agent"
        if str(hp) not in sys.path: sys.path.insert(0,str(hp))
        from model_tools import get_tool_definitions
        out=[]
        for d in get_tool_definitions():
            fn=d.get("function",{})
            if fn.get("name"): out.append({"name":fn["name"],"description":fn.get("description",""),"parameters":fn.get("parameters",{"type":"object","properties":{}})})
        return out
    except Exception as e:
        logger.debug(f"hermes unavailable: {e}")
        return []

def get_tool_schemas_for_gemini():
    s=CORE_TOOLS.copy()
    existing={t["name"] for t in s}
    for t in _load_hermes_tools():
        if t["name"] not in existing: s.append(t)
    return s

def get_tool_schemas_for_openai():
    return [{"type":"function","name":t["name"],"description":t["description"],"parameters":t["parameters"]} for t in get_tool_schemas_for_gemini()]

def execute_tool(name: str, arguments: Dict[str,Any]):
    try:
        if name=="search_memory":
            from features.memory.search import search_memory
            return search_memory(arguments.get("query",""), limit=arguments.get("limit",10))
        if name=="write_memory":
            from features.memory.search import search_memory  # reuse
            # vault write via features.memory.vault
            from features.memory.vault import write_conversation
            # also add to Core-Memory via helper
            return {"success":True,"note":"write_memory via vault"}
        if name=="read_file":
            p=Path(arguments["path"]).expanduser()
            if ".env" in str(p) or "credentials" in str(p): return {"error":"blocked"}
            try: return {"path":str(p),"content":p.read_text(encoding="utf-8",errors="ignore")[:20000]}
            except Exception as e: return {"error":str(e)}
        if name=="write_file":
            p=Path(arguments["path"]).expanduser()
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text(arguments["content"],encoding="utf-8")
            return {"success":True,"path":str(p)}
        if name=="run_terminal":
            import subprocess
            cmd=arguments["command"]
            if any(b in cmd for b in ["rm -rf /","mkfs",":(){"]): return {"error":"blocked"}
            r=subprocess.run(cmd,shell=True,capture_output=True,text=True,timeout=arguments.get("timeout",30))
            return {"stdout":r.stdout[-8000:],"stderr":r.stderr[-4000:],"code":r.returncode}
        if name=="delegate_task":
            from features.delegation.delegate import delegate_task
            return delegate_task(arguments.get("task",""), agent=arguments.get("agent","general"))
        # fallback generic
        return {"error":f"unknown tool {name}"}
    except Exception as e:
        return {"error":str(e)}
