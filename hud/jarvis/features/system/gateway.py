"""
System Gateway — from ~/.openclaw/openclaw.json:32 + hermes-agent/tools/file_tools.py + terminal_tool.py + computer_use/
Linux-native system control borrowed from OpenClaw (mainly built for linux) and Hermes tools.

Origin:
  - openclaw.json: gateway.mode:local, port:18789, tools.profile:coding
  - openclaw workspace: TOOLS.md, gateway/*, skills/*
  - hermes-agent/tools/file_tools.py: read_file/write_file with § delimiter, char limits
  - hermes-agent/tools/terminal_tool.py: terminal with env, cwd, timeout
  - hermes-agent/tools/computer_use_tool.py: background desktop via cua-driver

Present-dir wrapper: proxies to OpenClaw gateway when running, otherwise local subprocess.
"""
import subprocess, json
from pathlib import Path
from typing import Dict, Any

OPENCLAW_GATEWAY = "http://localhost:18789"
JARVIS_BACKEND = "http://localhost:8001"

def run_terminal(command: str, timeout: int=30, cwd: str="~") -> Dict[str,Any]:
    blocked=["rm -rf /","mkfs",":(){","chmod 777"]
    if any(b in command for b in blocked): return {"error":"blocked command","code":403}
    try:
        # Use present-dir CWD like hermes terminal_tool
        import os
        cwd_path = Path(cwd).expanduser() if cwd else Path.home()
        r=subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout, cwd=str(cwd_path))
        return {"stdout":r.stdout[-8000:],"stderr":r.stderr[-4000:],"code":r.returncode,"cwd":str(cwd_path)}
    except subprocess.TimeoutExpired:
        return {"error":f"timeout {timeout}s"}

def read_file(path: str, limit: int=200) -> Dict[str,Any]:
    p=Path(path).expanduser()
    if ".env" in str(p) and "JARVIS" not in str(p): return {"error":"blocked sensitive"}
    try:
        lines=p.read_text(encoding="utf-8",errors="ignore").splitlines()
        content="\n".join(lines[:limit])
        return {"path":str(p),"content":content,"total_lines":len(lines)}
    except Exception as e:
        return {"error":str(e)}

def write_file(path: str, content: str) -> Dict[str,Any]:
    p=Path(path).expanduser()
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(content,encoding="utf-8")
    return {"success":True,"path":str(p)}

def openclaw_status() -> Dict[str,Any]:
    import requests
    try:
        r=requests.get(f"{OPENCLAW_GATEWAY}/", timeout=3)
        return {"openclaw":r.status_code, "gateway":OPENCLAW_GATEWAY}
    except Exception as e:
        return {"openclaw":"offline","error":str(e),"gateway":OPENCLAW_GATEWAY}

def jarvis_status() -> Dict[str,Any]:
    import requests
    try:
        r=requests.get(f"{JARVIS_BACKEND}/health", timeout=3)
        return r.json()
    except Exception as e:
        return {"error":str(e)}
