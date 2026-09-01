"""
J.A.R.V.I.S. Python Core Engine — Master Entrypoint.
Orchestrates Gemini Live, Unix Socket Audio Bridge, Jinja2 Prompts, and FastAPI.
"""

import os
import sys
import argparse
import asyncio
import signal
import uvicorn
from dotenv import load_dotenv
load_dotenv(os.path.join(os.getcwd(), ".env"))
load_dotenv()

# Add parent directory to path for clean relative imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core_engine.security import security_guard
from core_engine.memory import memory_engine
from core_engine.prompt_engine import prompt_engine
from core_engine.actuator_dispatcher import actuator_dispatcher
from core_engine.audio_bridge import audio_bridge, DEFAULT_SOCKET_PATH
from core_engine.gemini_live import gemini_session
from core_engine.server import app
from core_engine.hud import launch_native_hud


def load_environment():
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    load_dotenv()


async def run_orchestrator(args):
    print("==========================================================")
    print("  🚀 J.A.R.V.I.S. PYTHON CORE ENGINE ONLINE")
    print("==========================================================")
    print(f"• Audio Gateway Socket: {args.socket_path}")
    print(f"• REST & WebSocket API: http://127.0.0.1:{args.port}")
    print(f"• Active Persona: {args.persona.upper()}")
    print(f"• Tools Registered: {len(actuator_dispatcher.get_tool_declarations())} tools")
    print("==========================================================")

    # 1. Initialize Memory Vault & Fresh Daily Session
    v_status = memory_engine.get_vault_status()
    snapshot = memory_engine.get_frozen_snapshot()
    print(f"[Core] 🧠 Memory Vault Connected: {v_status['vault_root']}")
    print(f"[Core] 📅 Active Daily Conversation: {v_status['today_conversation_file']}")
    print(f"[Core] 📚 Vault Index: {v_status['total_facts_indexed']} facts, {v_status['total_skills_indexed']} skills, {v_status['total_conversations_logged']} conversation logs")

    # 2. Render initial system prompt
    initial_prompt = prompt_engine.render_system_prompt(persona_id=args.persona)
    print(f"[Core] 📜 Initial prompt rendered ({len(initial_prompt)} chars).")

    if args.dry_run:
        print("[Core] ✅ Dry run successful. All subsystems initialized without errors.")
        return

    # 3. Start Audio Bridge (Unix Domain Socket server)
    audio_bridge.socket_path = args.socket_path
    await audio_bridge.start()

    print("[Core] 🟢 J.A.R.V.I.S. Core Engine ready. Waiting for UI connection...")

    # 5. Start FastAPI server
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info",
        access_log=False
    )
    server = uvicorn.Server(config)

    # Automatically open the UI in the default browser unless disabled
    if not getattr(args, "no_browser", False) and not os.environ.get("JARVIS_NO_BROWSER"):
        def open_browser():
            import time
            import webbrowser
            time.sleep(1.0)
            ui_url = f"http://localhost:{args.port}"
            print(f"[Core] 🌐 Launching J.A.R.V.I.S. React UI: {ui_url}")
            try:
                webbrowser.open(ui_url)
            except Exception:
                pass

        import threading
        threading.Thread(target=open_browser, daemon=True).start()

    try:
        await server.serve()
    finally:
        await gemini_session.close()
        await audio_bridge.stop()
        print("[Core] 🏁 J.A.R.V.I.S. Python Core Engine shutdown complete.")


def main():
    parser = argparse.ArgumentParser(description="Friday Python Core Engine")
    parser.add_argument("--port", type=int, default=8000, help="FastAPI port (default: 8000)")
    parser.add_argument("--socket-path", type=str, default=DEFAULT_SOCKET_PATH, help="Unix domain socket path")
    parser.add_argument("--persona", type=str, default="friday", help="AI Persona (friday, jarvis, ultron, edith, karen)")
    parser.add_argument("--dry-run", action="store_true", help="Initialize and verify components without listening indefinitely")
    parser.add_argument("--hud", action="store_true", help="Launch native PySide6 desktop HUD overlay")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open UI in browser on launch")
    args = parser.parse_args()

    load_environment()

    if args.hud:
        hud_app = launch_native_hud()

    try:
        asyncio.run(run_orchestrator(args))
    except KeyboardInterrupt:
        print("\n[Core] Process interrupted by user.")


if __name__ == "__main__":
    main()
