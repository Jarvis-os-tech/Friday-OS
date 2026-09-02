#!/usr/bin/env python3
"""
Friday-OS Python Gateway — 24/7 Telegram Bot + Heartbeat + Health HTTP.
Powered by the FridayTelegramChannel engine with FallbackTransport,
real-time typing indicators, and AG UI Protocol event synchronization.

Runs as a standalone systemd user service. Auto-starts on login.
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
from typing import Optional, Dict, Any, List

from dotenv import load_dotenv
from aiohttp import web

# ── Bootstrap: load .env ─────────────────────────────────────────────────────

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"

load_dotenv(_ENV_FILE, override=True)
load_dotenv()

# Ensure project root is on sys.path for core_engine and friday_telegram imports
sys.path.insert(0, str(_PROJECT_ROOT))

from friday_telegram.channel import FridayTelegramChannel
from friday_telegram.protocol import ag_ui_bridge, AGUIEventType

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
_channel: Optional[FridayTelegramChannel] = None

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

def _get_channel() -> FridayTelegramChannel:
    global _channel
    if _channel is None:
        _channel = FridayTelegramChannel(
            bot_token=BOT_TOKEN,
            allowed_chat_id=CHAT_ID,
        )
    return _channel


# ── Telegram Outbound Helper ─────────────────────────────────────────────────

async def _send_telegram(text: str, parse_mode: str = "HTML") -> bool:
    """Send message via FridayTelegramChannel with safe HTML formatting and ledger fallback."""
    if not BOT_TOKEN or not CHAT_ID:
        return False
    channel = _get_channel()
    res = await channel.send_message(
        chat_id=CHAT_ID,
        text=text,
        parse_mode=parse_mode,
    )
    return res.success


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

    # Emit telemetry event to AG UI protocol
    await ag_ui_bridge.emit(
        AGUIEventType.TELEMETRY,
        {
            "cpu": tel.get("cpu_usage_percent", 0),
            "ram": tel.get("ram_usage_percent", 0),
            "tick": _tick_count,
        }
    )

    # 1. Low battery alert
    if isinstance(battery, dict):
        pct = battery.get("percentage")
        charging = battery.get("charging", False)
        if pct is not None and pct < BATTERY_LOW and not charging:
            last = _alert_cooldowns.get("battery_low", 0.0)
            if now - last > _ALERT_COOLDOWN:
                _alert_cooldowns["battery_low"] = now
                await _send_telegram(
                    f"🚨 <b>Low Battery Alert</b>\n\n🔋 {pct}% remaining (discharging).\nPlease connect charger."
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
                f"🔥 <b>Thermal Alert</b>\n\n🌡️ Critical temperature detected: {max_temp}°C.\nUltron recommends throttling high-load tasks."
            )

    # 3. Morning digest (once per day after 8 AM)
    today = datetime.now().strftime("%Y-%m-%d")
    hour = datetime.now().hour
    if today != _last_digest_date and hour >= 8:
        _last_digest_date = today
        channel = _get_channel()
        digest = await channel._brain.get_system_status()
        await _send_telegram(f"🌅 <b>Good Morning, Boss!</b>\n\n{digest}")

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

_start_time = time.time()


async def _health_route(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "healthy",
        "service": "friday-gateway",
        "engine": "friday_telegram_v2_ag_ui",
        "telegram_configured": bool(BOT_TOKEN and CHAT_ID),
        "typing_indicator_active": True,
        "ag_ui_protocol": "active",
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
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        log.warning(f"Health HTTP server error: {e}")
    finally:
        await runner.cleanup()


# ── Main Entrypoint ──────────────────────────────────────────────────────────

async def _run():
    log.info("==========================================================")
    log.info("  🚀 F.R.I.D.A.Y. PYTHON GATEWAY (V2 TELEGRAM + AG UI) ONLINE")
    log.info("==========================================================")
    log.info(f"• Telegram: {'✅ Online (' + BOT_TOKEN[:10] + '...)' if BOT_TOKEN and CHAT_ID else '❌ Not configured'}")
    log.info(f"• Gemini 3.7: {'✅ Ready' if GEMINI_API_KEY else '❌ Missing Key'}")
    log.info(f"• Health Endpoint: http://127.0.0.1:{HEALTH_PORT}/health")
    log.info(f"• Heartbeat Pulse: Every {HEARTBEAT_INTERVAL}s")
    log.info(f"• Typing Indicator: Real-time active")
    log.info(f"• Protocol: AG UI Protocol V1.0")
    log.info("==========================================================")

    channel = _get_channel()

    tasks = [
        asyncio.create_task(_heartbeat_loop()),
        asyncio.create_task(_start_health_server()),
    ]

    if BOT_TOKEN and CHAT_ID:
        tasks.append(asyncio.create_task(channel.start()))
        # Send startup notification
        await _send_telegram(
            "🟢 <b>F.R.I.D.A.Y. Sovereign Gateway Online</b>\n\n"
            "Autonomous 24/7 Engine is now running with real-time typing indicators and AG UI Protocol.\n"
            "Send /help to view commands."
        )
    else:
        log.warning("Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        await channel.stop()
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
