#!/usr/bin/env python3
"""Run JARVIS UI connected to localhost:3000 Gemini Backend."""
import subprocess, sys, time, pathlib, os

ROOT = pathlib.Path(__file__).parent

def run_ui():
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8000"],
        cwd=str(ROOT),
        stdout=sys.stdout, stderr=sys.stderr
    )
    return proc

if __name__ == "__main__":
    print(f"Serving JARVIS HUD from {ROOT} on http://localhost:8000 ...")
    print("Connected to Gemini Intelligence Backend on http://localhost:3000")
    u = run_ui()
    print("\n>>> Open HUD in browser: http://localhost:8000/index.html")
    print(">>> Or via Node server: http://localhost:3000/hud/index.html\n")
    try:
        u.wait()
    except KeyboardInterrupt:
        print("\nStopping...")
        try: u.terminate()
        except: pass
        sys.exit(0)
