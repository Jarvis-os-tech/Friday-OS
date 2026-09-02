#!/usr/bin/env python3
"""
Friday-OS — Standalone Telegram Channel Service
Runs the complete Friday Telegram Gateway with FallbackTransport,
typing indicators, and AG UI protocol.
"""

import sys
import os
import signal
import asyncio
import logging
from pathlib import Path
from dotenv import load_dotenv

# Ensure project root is on sys.path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

load_dotenv(_PROJECT_ROOT / ".env", override=True)

from friday_telegram.channel import FridayTelegramChannel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("friday.telegram")


async def main():
    log.info("Starting Friday-OS Telegram Gateway...")
    channel = FridayTelegramChannel()
    await channel.start()

    stop_event = asyncio.Event()

    def _sig_handler():
        log.info("Shutdown signal received...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _sig_handler)
        except NotImplementedError:
            pass

    try:
        await stop_event.wait()
    finally:
        await channel.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
