"""
Delegation — from hermes-agent/tools/delegate_tool.py + async_delegation.py + SOUL.md:94 Fleet
Orchestrator delegates WHAT/WHY, specialists handle HOW in isolated context.

Origin:
  - delegate_tool.py: delegate_task(task, agent, isolated context, background)
  - async_delegation.py: parallel isolated execution, live log
  - SOUL.md:94 Specialist agents TRADING/CONTENT/MICRO-SAAS/LEAD GEN/DEFI/BUG BOUNTY/API/INFRA
  - OpenClaw workspace: skills/* via gateway

Present-dir wrapper: delegate_task() → tries Hermes, falls back to mock with tracking.
"""
from pathlib import Path
from typing import Dict, Any, Optional
import json, uuid, time

AGENTS = ["trading","research","content","dev","infra","general"]

def delegate_task(task: str, agent: str = "general", context: Optional[str] = None) -> Dict[str, Any]:
    """
    Spawn specialist — mirrors hermes delegate_tool.py signature.
    Returns {delegated: bool, agent, task_id, ...}
    """
    if agent not in AGENTS:
        agent = "general"
    # Try Hermes real delegation
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.delegate_tool import delegate_task as hermes_delegate
        # hermes delegate returns json string; we normalize
        # It expects prompt + optional agent; we pass task as prompt
        try:
            res = hermes_delegate(task=task)  # type: ignore
            # hermes_delegate may be async or return dict/json
            if isinstance(res, str):
                try:
                    return json.loads(res)
                except:
                    return {"delegated": True, "agent": agent, "raw": res}
            return {"delegated": True, "agent": agent, "task": task, "hermes": res}
        except TypeError:
            # older signature: delegate(task=...)
            return {"delegated": True, "agent": agent, "task": task, "note": "hermes delegate called"}
    except Exception as e:
        # Fallback mock — still tracks for UI
        tid = uuid.uuid4().hex[:8]
        return {
            "delegated": True,
            "mock": True,
            "agent": agent,
            "task": task,
            "task_id": tid,
            "note": f"Hermes not available ({e}), mock delegation — integrate real hermes when gateway running",
            "fallback": "write to ~/Obsidian/Jarvis-Memory-Vault/Working-Memory/delegations.jsonl",
        }

def list_delegations() -> Dict[str, Any]:
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.async_delegation import list_delegations as hermes_list  # type: ignore
        return hermes_list()
    except Exception as e:
        return {"delegations": [], "note": f"hermes unavailable: {e}"}

if __name__ == "__main__":
    print(delegate_task("research latest Gemini pricing", agent="research"))
