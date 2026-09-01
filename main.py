#!/usr/bin/env python3
"""
J.A.R.V.I.S. Root Orchestrator Entrypoint.
Run directly with: python main.py
"""

import sys
import os
import subprocess
import signal
import time
# Auto re-execute with virtual environment if needed before importing any 3rd party dependencies
REQUIRED_PKGS = ["dotenv", "fastapi", "uvicorn", "websockets", "jinja2"]
missing = []
for pkg in REQUIRED_PKGS:
    try:
        __import__(pkg)
    except ImportError:
        missing.append(pkg)

if missing:
    venv_candidates = [
        os.path.expanduser("~/.venv/bin/python"),
        os.path.expanduser("~/.venv/bin/python3"),
        os.path.expanduser("~/.hermes/hermes-agent/.venv/bin/python"),
        os.path.join(os.getcwd(), "venv", "bin", "python"),
        os.path.join(os.getcwd(), ".venv", "bin", "python"),
    ]
    for cand in venv_candidates:
        if os.path.exists(cand) and cand != sys.executable:
            print(f"[Launcher] Switching to configured Python environment: {cand}")
            os.execv(cand, [cand] + sys.argv)
            sys.exit(0)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    load_dotenv()
except ImportError:
    pass

# Add current directory to path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from core_engine.main import main as core_main

RUST_GATEWAY_BIN = os.path.join(os.path.dirname(__file__), "gateway_rust", "target", "release", "jarvis-gateway")


def spawn_rust_audio_gateway():
    """
    Spawns the Rust audio gateway in the background if compiled.
    """
    if os.path.exists(RUST_GATEWAY_BIN):
        try:
            proc = subprocess.Popen(
                [RUST_GATEWAY_BIN, "--socket-path", "/tmp/jarvis_audio.sock"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            return proc
        except Exception as e:
            print(f"[Launcher] Note: Could not auto-start Rust audio gateway: {e}")
    return None


if __name__ == "__main__":
    rust_proc = None
    if "--standalone-audio" in sys.argv:
        sys.argv.remove("--standalone-audio")
        rust_proc = spawn_rust_audio_gateway()
        if rust_proc:
            print(f"[Launcher] 🎙 Rust Microsecond Audio Gateway started (PID: {rust_proc.pid})")

    try:
        core_main()
    finally:
        if rust_proc and rust_proc.poll() is None:
            print("[Launcher] Stopping Rust Audio Gateway...")
            rust_proc.terminate()
            try:
                rust_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                rust_proc.kill()
