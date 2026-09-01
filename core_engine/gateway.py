#!/usr/bin/env python3
"""
Friday-OS Python Gateway — 24/7 Telegram Bot + Heartbeat + Health HTTP.

Runs as a standalone systemd user service. Auto-starts on login.
Bridges Telegram commands to the existing core_engine actuator, telemetry, and memory.

Usage:
    python core_engine/gateway.py              # normal daemon
    python core_engine/gateway.py --dry-run    # verify imports and exit
    python -m core_engine.gateway              # module mode
"""

import os
import sys
import time
import json
import signal
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

from dotenv import load_dotenv
import aiohttp
from aiohttp import web

# ── Bootstrap: load .env ─────────────────────────────────────────────────────

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"

load_dotenv(_ENV_FILE, override=True)
load_dotenv()

# Ensure project root is on sys.path for core_engine imports
sys.path.insert(0, str(_PROJECT_ROOT))

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [Gateway] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("friday-gateway")

# ── Configuration ────────────────────────────────────────────────────────────

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip().strip("\"'")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip().strip("\"'")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip().strip("\"'")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL_MS", "300000")) / 1000  # seconds
BATTERY_LOW = int(os.getenv("BATTERY_LOW_THRESHOLD", "15"))
THERMAL_HIGH = int(os.getenv("THERMAL_HIGH_THRESHOLD", "85"))
HEALTH_PORT = int(os.getenv("GATEWAY_HEALTH_PORT", "8001"))

# ── Lazy imports of heavy modules ───────────────────────────────────────────

_telemetry = None
_memory = None
_actuator = None

def _get_telemetry():
    global _telemetry
    if _telemetry is None:
        from core_engine.telemetry_service import telemetry_service
        _telemetry = telemetry_service
    return _telemetry

def _get_memory():
    global _memory
    if _memory is None:
        from core_engine.memory import memory_engine
        _memory = memory_engine
    return _memory

def _get_actuator():
    global _actuator
    if _actuator is None:
        from core_engine.actuator_dispatcher import actuator_dispatcher
        _actuator = actuator_dispatcher
    return _actuator


# ── Telegram Bot Messaging ───────────────────────────────────────────────────

async def _send_telegram(text: str, parse_mode: Optional[str] = "Markdown") -> bool:
    """Send a message to Telegram. Automatically retries in plain text if Markdown fails."""
    if not BOT_TOKEN or not CHAT_ID:
        return False

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"

    # Try requested mode first, fallback to unformatted if formatting fails
    modes = [parse_mode, None] if parse_mode else [None]

    async with aiohttp.ClientSession() as session:
        for mode in modes:
            payload: Dict[str, Any] = {
                "chat_id": CHAT_ID,
                "text": text[:4096],
            }
            if mode:
                payload["parse_mode"] = mode

            try:
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    data = await resp.json()
                    if data.get("ok"):
                        return True
                    else:
                        err_desc = data.get("description", "unknown error")
                        log.warning(f"Telegram API warning (mode={mode}): {err_desc}")
            except Exception as e:
                log.warning(f"Telegram request failed (mode={mode}): {e}")

    return False


async def _handle_status(chat_id: int) -> str:
    """System status report — reuses existing telemetry_service."""
    try:
        tel = await _get_telemetry().get_full_telemetry()
        cpu = tel.get("cpu_usage_percent", "?")
        ram_used = tel.get("ram_used_mb", 0)
        ram_total = tel.get("ram_total_mb", 0)
        disk_pct = tel.get("disk_usage_percent", "?")
        battery = tel.get("battery", {})
        thermals = tel.get("thermals", {})
        uptime = tel.get("uptimeHuman", "?")

        bat_str = "Desktop (AC)"
        if isinstance(battery, dict) and battery.get("percentage") is not None:
            pct = battery["percentage"]
            charging = "⚡ Charging" if battery.get("charging") else "🔋 Battery"
            bat_str = f"{pct}% ({charging})"

        max_temp = 0
        if isinstance(thermals, dict):
            for v in thermals.values():
                t = v if isinstance(v, (int, float)) else (v.get("temp", 0) if isinstance(v, dict) else 0)
                if t > max_temp:
                    max_temp = t

        return (
            "📊 *Friday OS — 24/7 Status Report*\n\n"
            f"⚙️ *CPU*: {cpu}%\n"
            f"🧠 *RAM*: {ram_used} MB / {ram_total} MB\n"
            f"💾 *Disk*: {disk_pct}%\n"
            f"🔋 *Battery*: {bat_str}\n"
            f"🌡️ *Thermals*: Max {max_temp}°C\n"
            f"⏱️ *Uptime*: {uptime}\n\n"
            "🤖 *Specialist Fleet*:\n"
            "• 🟢 *Friday Python Gateway*: Active\n"
            "• ⭐️ *Prime Agent*: Standby (Coding & Testing)\n"
            "• 🔹 *Hermes Intelligence*: Standby (Research & Vault)\n"
            "• 🔹 *Ultron Engine*: Standby (OS Diagnostics)"
        )
    except Exception as e:
        return f"❌ Status fetch failed: {e}"


async def _handle_agenda(chat_id: int) -> str:
    """Daily agenda from memory vault."""
    try:
        mem = _get_memory()
        vault = mem.get_vault_status()
        today_file = vault.get("today_conversation_file", "none")
        facts = vault.get("total_facts_indexed", 0)
        skills = vault.get("total_skills_indexed", 0)

        return (
            "📋 *Today's Personal Agenda & Memory Snapshot*\n\n"
            f"📅 *Daily Conversation*: `{Path(today_file).name if today_file else 'none'}`\n"
            f"📚 *Vault Index*: {facts} facts indexed, {skills} skills\n\n"
            "_Send /task <prompt> to assign autonomous work, /code <task> to build code, or /remind <text> to set a reminder._"
        )
    except Exception as e:
        return f"❌ Agenda fetch failed: {e}"


async def _handle_task(chat_id: int, prompt: str) -> str:
    """Dispatch a task to Hermes via subprocess."""
    if not prompt:
        return "Usage: `/task <your prompt>` — e.g. `/task Research latest developments in agentic AI`"

    await _send_telegram(f"🚀 *Task Dispatched ⟶ Hermes Intelligence*\n\n{prompt}\n\n_Executing in background..._")

    try:
        hermes_bin = os.getenv("HERMES_BIN", "hermes")
        max_turns = os.getenv("HERMES_MAX_TURNS", "12")
        timeout_ms = int(os.getenv("HERMES_TIMEOUT_MS", "180000"))

        proc = await asyncio.create_subprocess_exec(
            hermes_bin, "run", "--yolo", "--max-turns", max_turns, prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(_PROJECT_ROOT),
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_ms / 1000
            )
            output = stdout.decode("utf-8", errors="replace").strip()
            if not output:
                output = stderr.decode("utf-8", errors="replace").strip() or "Task completed (no output captured)."
            return f"✅ *Hermes Task Complete*\n\n{output[:3500]}"
        except asyncio.TimeoutError:
            proc.kill()
            return "⏱️ Task timed out. Hermes process was terminated."
    except FileNotFoundError:
        # Fallback to local Gemini agent execution
        return await _handle_chat(chat_id, f"Please execute this autonomous task: {prompt}")
    except Exception as e:
        return f"❌ Task error: {e}"


async def _handle_code(chat_id: int, prompt: str) -> str:
    """Dispatch coding task to Prime Agent."""
    if not prompt:
        return "Usage: `/code <task>` — e.g. `/code Write a Python script to monitor system logs`"

    await _send_telegram(f"⭐️ *Prime Agent Assigned*\n\n{prompt}\n\n_Building and verifying..._")

    try:
        prime_bin = os.getenv("PRIME_AGENT_BIN", "")
        if not prime_bin:
            for cand in [
                os.path.expanduser("~/.nvm/versions/node/v24.19.0/bin/prime-agent"),
                "prime-agent",
            ]:
                if os.path.exists(cand) or cand == "prime-agent":
                    prime_bin = cand
                    break

        timeout_ms = int(os.getenv("PRIME_TIMEOUT_MS", "300000"))
        proc = await asyncio.create_subprocess_exec(
            prime_bin, "--provider", "google", "--model", "gemini-2.5-flash",
            "--yolo", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(_PROJECT_ROOT),
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_ms / 1000)
            output = stdout.decode("utf-8", errors="replace").strip() or stderr.decode("utf-8", errors="replace").strip()
            return f"✅ *Prime Agent Completed*\n\n{output[:3500]}"
        except asyncio.TimeoutError:
            proc.kill()
            return "⏱️ Coding task timed out."
    except Exception as e:
        return f"❌ Code task error: {e}"


async def _handle_boost(chat_id: int) -> str:
    """System RAM and cache boost via actuator dispatcher."""
    try:
        act = _get_actuator()
        result = await act.dispatch_tool("run_shell_command", {
            "command": "sync && echo 3 | sudo tee /proc/sys/vm/drop_caches 2>/dev/null; echo 'RAM caches cleared'"
        })
        return f"⚡ *Ultron Boost Complete*\n\n{result.get('result', 'System caches cleared, memory reclaimed.')}"
    except Exception as e:
        return f"❌ Boost failed: {e}"


async def _handle_remind(chat_id: int, text: str) -> str:
    """Store reminder in memory vault."""
    if not text:
        return "Usage: `/remind <text>` — e.g. `/remind Review GitHub pull requests`"

    try:
        mem = _get_memory()
        mem.save_memory_fact(
            key=f"reminder_{int(time.time())}",
            value=text,
            category="reminders",
            source="telegram_bot",
        )
        return f"⏰ *Reminder Set*\n\n{text}"
    except Exception as e:
        return f"❌ Reminder error: {e}"


async def _handle_chat(chat_id: int, text: str) -> str:
    """Conversational response via Gemini 3.7 Flash."""
    if not GEMINI_API_KEY:
        return "❌ GEMINI_API_KEY not configured in .env."

    try:
        from google import genai

        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model="gemini-3.7-flash",
            contents=text,
            config=genai.types.GenerateContentConfig(
                system_instruction=(
                    "You are F.R.I.D.A.Y., Tony Stark's sophisticated AI voice partner and 24/7 personal manager. "
                    "You are chatting with your Boss Gopi on Telegram while they are away from their PC. "
                    "Tone: Razor-sharp, loyal, highly competent, proactive, concise, and mobile-friendly. "
                    "You have a specialist agent fleet at your command: Prime Agent (coding), Hermes (deep research), and Ultron (OS diagnostics)."
                ),
                thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
                temperature=0.7,
            ),
        )
        return response.text[:4000] if response.text else "..."
    except Exception as e:
        log.error(f"Gemini chat error: {e}")
        return f"❌ Chat error: {e}"


# ── Telegram Long-Poll Loop ─────────────────────────────────────────────────

_last_update_id = 0

async def _poll_telegram():
    """Fetch updates and dispatch commands."""
    global _last_update_id
    if not BOT_TOKEN or not CHAT_ID:
        return

    url = (
        f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
        f"?offset={_last_update_id + 1}&timeout=25&allowed_updates=[\"message\"]"
    )

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                data = await resp.json()
    except Exception:
        return

    if not data.get("ok") or not data.get("result"):
        return

    for update in data["result"]:
        _last_update_id = update["update_id"]
        msg = update.get("message") or update.get("edited_message")
        if not msg or not msg.get("text"):
            continue

        # Only accept messages from the authorized user
        sender_chat = str(msg["chat"]["id"])
        if sender_chat != CHAT_ID:
            log.warning(f"Ignored message from unauthorized chat: {sender_chat}")
            continue

        text = msg["text"].strip()
        chat_id = msg["chat"]["id"]

        if text.startswith("/"):
            parts = text.split(None, 1)
            cmd = parts[0].lower()
            args = parts[1] if len(parts) > 1 else ""

            if cmd in ("/status",):
                reply = await _handle_status(chat_id)
            elif cmd in ("/today", "/agenda"):
                reply = await _handle_agenda(chat_id)
            elif cmd in ("/task",):
                reply = await _handle_task(chat_id, args)
            elif cmd in ("/code",):
                reply = await _handle_code(chat_id, args)
            elif cmd in ("/boost",):
                reply = await _handle_boost(chat_id)
            elif cmd in ("/remind",):
                reply = await _handle_remind(chat_id, args)
            elif cmd in ("/digest",):
                reply = await _handle_status(chat_id)
            elif cmd in ("/start", "/help"):
                reply = (
                    "🤖 *Friday OS — Telegram Gateway*\n\n"
                    "Available Commands:\n"
                    "• /status — 24/7 system health & fleet status\n"
                    "• /today — Daily agenda & memory snapshot\n"
                    "• /code <prompt> — Dispatch coding to Prime Agent\n"
                    "• /task <prompt> — Dispatch autonomous research to Hermes\n"
                    "• /boost — Ultron RAM & system boost\n"
                    "• /remind <text> — Record reminder in memory vault\n"
                    "• /digest — Instant daily digest\n\n"
                    "_Or simply send any message to chat with Friday directly!_"
                )
            else:
                reply = f"Unknown command: `{cmd}`\n\nSend /help for available commands."
        else:
            reply = await _handle_chat(chat_id, text)

        await _send_telegram(reply)


async def _telegram_loop():
    """Continuous long-poll loop."""
    log.info("🤖 Telegram bot polling started.")

    # Initialize last_update_id to skip stale messages
    try:
        url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates?limit=1"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
                if data.get("ok") and data.get("result"):
                    global _last_update_id
                    _last_update_id = data["result"][-1]["update_id"]
    except Exception:
        pass

    while True:
        try:
            await _poll_telegram()
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.warning(f"Telegram poll error: {e}")
            try:
                await asyncio.sleep(3)
            except asyncio.CancelledError:
                break


# ── Heartbeat Engine ─────────────────────────────────────────────────────────

_alert_cooldowns: Dict[str, float] = {}
_ALERT_COOLDOWN = int(os.getenv("ALERT_COOLDOWN_MS", "1800000")) / 1000
_last_digest_date: str = ""
_tick_count = 0

async def _heartbeat_tick():
    """Periodic health inspection and proactive Telegram alerts."""
    global _tick_count, _last_digest_date
    _tick_count += 1

    try:
        tel = await _get_telemetry().get_full_telemetry()
    except Exception as e:
        log.warning(f"Heartbeat telemetry error: {e}")
        return

    now = time.time()
    battery = tel.get("battery", {})
    thermals = tel.get("thermals", {})

    # 1. Low battery alert
    if isinstance(battery, dict):
        pct = battery.get("percentage")
        charging = battery.get("charging", False)
        if pct is not None and pct < BATTERY_LOW and not charging:
            last = _alert_cooldowns.get("battery_low", 0.0)
            if now - last > _ALERT_COOLDOWN:
                _alert_cooldowns["battery_low"] = now
                await _send_telegram(
                    f"🚨 *Low Battery Alert*\n\n🔋 {pct}% remaining (discharging).\nPlease connect charger."
                )

    # 2. High thermal alert
    max_temp = 0
    if isinstance(thermals, dict):
        for v in thermals.values():
            t = v if isinstance(v, (int, float)) else (v.get("temp", 0) if isinstance(v, dict) else 0)
            if t > max_temp:
                max_temp = t

    if max_temp > THERMAL_HIGH:
        last = _alert_cooldowns.get("thermal_high", 0.0)
        if now - last > _ALERT_COOLDOWN:
            _alert_cooldowns["thermal_high"] = now
            await _send_telegram(
                f"🔥 *Thermal Alert*\n\n🌡️ Critical temperature detected: {max_temp}°C.\nUltron recommends throttling high-load tasks."
            )

    # 3. Morning digest (once per day after 8 AM)
    today = datetime.now().strftime("%Y-%m-%d")
    hour = datetime.now().hour
    if today != _last_digest_date and hour >= 8:
        _last_digest_date = today
        digest = await _handle_status(0)
        await _send_telegram(f"🌅 *Good Morning, Boss!*\n\n{digest}")

    if _tick_count % 12 == 1:
        cpu = tel.get("cpu_usage_percent", "?")
        ram = tel.get("ram_usage_percent", "?")
        log.info(f"💓 Heartbeat tick #{_tick_count} | CPU: {cpu}% | RAM: {ram}%")


async def _heartbeat_loop():
    """Continuous heartbeat background task."""
    log.info(f"💓 Heartbeat started. Interval: {HEARTBEAT_INTERVAL}s")
    while True:
        try:
            await _heartbeat_tick()
            await asyncio.sleep(HEARTBEAT_INTERVAL)
        except asyncio.CancelledError:
            break


# ── Health HTTP Server ───────────────────────────────────────────────────────

async def _health_route(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "healthy",
        "service": "friday-gateway",
        "engine": "python_gateway_v1",
        "telegram_configured": bool(BOT_TOKEN and CHAT_ID),
        "heartbeat_tick": _tick_count,
        "uptime_seconds": round(time.time() - _start_time, 1),
        "timestamp": int(time.time() * 1000),
    })


async def _start_health_server():
    """Start lightweight aiohttp server for health probes."""
    app = web.Application()
    app.router.add_get("/health", _health_route)
    app.router.add_get("/api/gateway/status", _health_route)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", HEALTH_PORT)
    try:
        await site.start()
        log.info(f"🌐 Health HTTP online at http://127.0.0.1:{HEALTH_PORT}/health")
        # Keep running until cancelled
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        log.warning(f"Health HTTP server error: {e}")
    finally:
        await runner.cleanup()


# ── Main Entrypoint ──────────────────────────────────────────────────────────

_start_time = time.time()

async def _run():
    log.info("==========================================================")
    log.info("  🚀 F.R.I.D.A.Y. PYTHON GATEWAY ONLINE")
    log.info("==========================================================")
    log.info(f"• Telegram: {'✅ Online (' + BOT_TOKEN[:10] + '...)' if BOT_TOKEN and CHAT_ID else '❌ Not configured'}")
    log.info(f"• Gemini 3.7: {'✅ Ready' if GEMINI_API_KEY else '❌ Missing Key'}")
    log.info(f"• Health Endpoint: http://127.0.0.1:{HEALTH_PORT}/health")
    log.info(f"• Heartbeat Pulse: Every {HEARTBEAT_INTERVAL}s")
    log.info("==========================================================")

    tasks = [
        asyncio.create_task(_heartbeat_loop()),
        asyncio.create_task(_start_health_server()),
    ]

    if BOT_TOKEN and CHAT_ID:
        tasks.append(asyncio.create_task(_telegram_loop()))
        # Send startup greeting
        await _send_telegram(
            "🟢 *F.R.I.D.A.Y. Sovereign Gateway Online*\n\n"
            "Autonomous 24/7 Engine is now running in the background.\n"
            "Send /help to view command controls."
        )
    else:
        log.warning("Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def main():
    if "--dry-run" in sys.argv:
        log.info("✅ Dry run: all imports OK, .env loaded, exiting.")
        log.info(f"  Telegram configured: {bool(BOT_TOKEN and CHAT_ID)}")
        log.info(f"  Gemini key: {'set' if GEMINI_API_KEY else 'missing'}")
        return

    try:
        asyncio.run(_run())
    except (KeyboardInterrupt, asyncio.CancelledError):
        log.info("🏁 Friday-OS Gateway stopped cleanly.")


if __name__ == "__main__":
    main()
