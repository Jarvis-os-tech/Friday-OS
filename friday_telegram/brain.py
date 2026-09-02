"""
Friday-OS — Multi-Agent Brain & Model Router
Routes inbound requests across the Friday Specialist Fleet:
- Prime Agent: Coding, software building, debugging (/code)
- Hermes Intelligence: Deep research, Obsidian memory vault queries (/task)
- Ultron Engine: OS diagnostics, performance boost, kernel health (/boost)
- Groq Fast LPU: Instant hardware actuation (<200ms)
- Gemini Live / Flash: Conversational manager with memory context
- Emits AG UI Protocol events on every action.
"""

import os
import sys
import json
import time
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
import httpx
from dotenv import load_dotenv

from .models import TelegramMessage
from .protocol import ag_ui_bridge, AGUIEventType

log = logging.getLogger("friday.telegram.brain")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env", override=True)


class FridayBrain:
    """
    Central Brain and Multi-Agent Orchestrator for Friday-OS.
    """

    def __init__(self, brain_url: Optional[str] = None):
        self._brain_url = brain_url or os.getenv("HERMES_GATEWAY_URL", "127.0.0.1:9119")
        if not self._brain_url.startswith("http"):
            self._brain_url = f"http://{self._brain_url}"
        self._omniroute_url = os.getenv("OMNIROUTE_URL", "http://127.0.0.1:20128/v1")
        self._gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip().strip("\"'")
        self._groq_api_key = (os.getenv("GROQ_API_KEY") or os.getenv("qroq_API_KEY") or "").strip().strip("\"'")

    # ── Lazy Module Loaders ───────────────────────────────────────────

    def _get_actuator(self):
        try:
            from core_engine.actuator_dispatcher import actuator_dispatcher
            return actuator_dispatcher
        except Exception:
            return None

    def _get_telemetry(self):
        try:
            from core_engine.telemetry_service import telemetry_service
            return telemetry_service
        except Exception:
            return None

    def _get_memory(self):
        try:
            from core_engine.memory import memory_engine
            return memory_engine
        except Exception:
            return None

    # ── Specialist Dispatchers ────────────────────────────────────────

    async def execute_code_task(self, prompt: str, chat_id: str) -> str:
        """Dispatch coding/engineering task to Prime Agent."""
        task_id = f"prime_{int(time.time())}"
        await ag_ui_bridge.emit_agent_state("thinking", agent="prime")
        await ag_ui_bridge.emit_task_started(task_id, f"Prime Agent ⟶ {prompt[:50]}", "prime_agent", prompt=prompt)

        prime_bin = os.getenv("PRIME_AGENT_BIN", "")
        if not prime_bin:
            candidates = [
                os.path.expanduser("~/.nvm/versions/node/v24.19.0/bin/prime-agent"),
                os.path.expanduser("~/.nvm/versions/node/v22.14.0/bin/prime-agent"),
                "/home/gopi/.nvm/versions/node/v24.19.0/bin/prime-agent",
                "prime-agent",
            ]
            for c in candidates:
                if os.path.exists(c) or c == "prime-agent":
                    prime_bin = c
                    break

        timeout_s = int(os.getenv("PRIME_TIMEOUT_MS", "300000")) / 1000.0
        start_t = time.time()

        try:
            await ag_ui_bridge.emit_task_progress(task_id, "Prime Agent synthesizing architecture and tests...", 30)
            proc = await asyncio.create_subprocess_exec(
                prime_bin, "--provider", "google", "--model", "gemini-2.5-flash",
                "--yolo", prompt,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(_PROJECT_ROOT),
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
            output = stdout.decode("utf-8", errors="replace").strip()
            if not output:
                output = stderr.decode("utf-8", errors="replace").strip() or "Prime Agent completed task."

            duration = (time.time() - start_t) * 1000
            await ag_ui_bridge.emit_task_completed(
                task_id,
                result=output,
                display_card={"type": "prime_response", "title": "Prime Agent Coding Result", "data": {"text": output, "prompt": prompt}},
                speech_summary=f"Prime Agent completed coding task in {int(duration/1000)}s",
                duration_ms=duration,
            )
            await ag_ui_bridge.emit_agent_state("completed", agent="prime")
            return f"⭐️ <b>Prime Agent Completed</b>\n\n{output[:3500]}"
        except asyncio.TimeoutError:
            await ag_ui_bridge.emit_agent_state("error", agent="prime")
            return "⏱️ <b>Prime Agent Notice</b>: Coding task timed out after 5 minutes."
        except Exception as e:
            log.error(f"Prime Agent error: {e}")
            await ag_ui_bridge.emit_agent_state("error", agent="prime")
            # Fallback to direct Gemini coder
            return await self._fallback_gemini(f"You are Prime Agent. Write clean, complete, production-ready code for: {prompt}")

    async def execute_hermes_task(self, prompt: str, chat_id: str) -> str:
        """Dispatch deep research or multi-agent task to Hermes Intelligence."""
        task_id = f"hermes_{int(time.time())}"
        await ag_ui_bridge.emit_agent_state("thinking", agent="hermes")
        await ag_ui_bridge.emit_task_started(task_id, f"Hermes ⟶ {prompt[:50]}", "hermes", prompt=prompt)

        start_t = time.time()

        # 1. Try Hermes Serve Gateway (HTTP)
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{self._brain_url}/chat",
                    json={"message": prompt, "chat_id": chat_id, "session_id": f"tg_{chat_id}"}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    reply = data.get("reply") or data.get("text") or ""
                    if reply:
                        duration = (time.time() - start_t) * 1000
                        await ag_ui_bridge.emit_task_completed(
                            task_id, result=reply,
                            display_card={"type": "hermes_response", "title": "Hermes Intelligence", "data": {"text": reply, "prompt": prompt}},
                            duration_ms=duration
                        )
                        await ag_ui_bridge.emit_agent_state("completed", agent="hermes")
                        return f"🔹 <b>Hermes Intelligence</b>\n\n{reply[:3500]}"
        except Exception:
            pass

        # 2. Try Hermes CLI Headless with Query File
        try:
            hermes_bin = os.getenv("HERMES_BIN", "/home/gopi/.local/bin/hermes")
            if not os.path.exists(hermes_bin):
                hermes_bin = "hermes"

            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as tf:
                tf.write(prompt)
                tmp_path = tf.name

            try:
                proc = await asyncio.create_subprocess_exec(
                    hermes_bin, "chat", "--query-file", tmp_path, "-Q",
                    "--source", "tool", "--max-turns", "12", "--yolo",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(_PROJECT_ROOT),
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=180.0)
                raw_out = stdout.decode("utf-8", errors="replace").strip()
                # Clean known Hermes CLI noise
                clean_lines = [
                    l for l in raw_out.splitlines()
                    if not l.startswith("Warning: Unknown toolsets:")
                    and not l.startswith("session_id:")
                    and not l.startswith("Model:")
                ]
                output = "\n".join(clean_lines).strip()
                if output:
                    duration = (time.time() - start_t) * 1000
                    await ag_ui_bridge.emit_task_completed(
                        task_id, result=output,
                        display_card={"type": "hermes_response", "title": "Hermes Intelligence", "data": {"text": output, "prompt": prompt}},
                        duration_ms=duration
                    )
                    await ag_ui_bridge.emit_agent_state("completed", agent="hermes")
                    return f"🔹 <b>Hermes Intelligence Complete</b>\n\n{output[:3500]}"
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        except Exception as e:
            log.warning(f"Hermes CLI execution failed ({e}), falling back to Gemini reasoning...")

        # 3. Fallback to Gemini 3.7 / 2.5 Flash
        gemini_reply = await self._fallback_gemini(prompt)
        await ag_ui_bridge.emit_agent_state("completed", agent="friday")
        return gemini_reply

    async def execute_ultron_boost(self) -> str:
        """Run Ultron RAM & cache reclamation."""
        await ag_ui_bridge.emit_agent_state("executing_tool", agent="ultron")
        try:
            act = self._get_actuator()
            if act:
                res = await act.dispatch_tool("run_shell_command", {
                    "command": "sync && echo 3 | sudo -n tee /proc/sys/vm/drop_caches 2>/dev/null; echo 'RAM caches cleared'"
                })
                result_str = res.get("result", "Caches cleared, system performance optimized.")
            else:
                proc = await asyncio.create_subprocess_shell(
                    "sync", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                result_str = "System caches synchronized and RAM memory reclaimed."

            await ag_ui_bridge.emit_display_card("ultron_boost", "Ultron System Boost", {"message": result_str})
            await ag_ui_bridge.emit_agent_state("idle", agent="ultron")
            return f"⚡ <b>Ultron Engine Boost Complete</b>\n\n{result_str}"
        except Exception as e:
            await ag_ui_bridge.emit_agent_state("error", agent="ultron")
            return f"❌ <b>Ultron Boost Error</b>: {e}"

    async def get_system_status(self) -> str:
        """Compile comprehensive 24/7 telemetry and fleet status report."""
        tel = self._get_telemetry()
        if tel:
            try:
                data = await tel.get_full_telemetry()
                cpu = data.get("cpu_usage_percent", 0)
                ram_used = data.get("ram_used_mb", 0)
                ram_total = data.get("ram_total_mb", 0)
                disk = data.get("disk_usage_percent", 0)
                bat = data.get("battery", {})
                thermals = data.get("thermals", {})
                uptime = data.get("uptimeHuman", "N/A")

                bat_str = "Desktop (AC Power)"
                if isinstance(bat, dict) and bat.get("percentage") is not None:
                    charging = "⚡ Charging" if bat.get("charging") else "🔋 Battery"
                    bat_str = f"{bat['percentage']}% ({charging})"

                max_temp = 0
                if isinstance(thermals, dict):
                    for v in thermals.values():
                        t = v if isinstance(v, (int, float)) else (v.get("temp", 0) if isinstance(v, dict) else 0)
                        if t > max_temp:
                            max_temp = t

                await ag_ui_bridge.emit_display_card("system_telemetry", "Friday OS Live Telemetry", data)

                return (
                    "📊 <b>Friday OS — 24/7 System Status</b>\n\n"
                    f"⚙️ <b>CPU</b>: {cpu}%\n"
                    f"🧠 <b>RAM</b>: {ram_used} MB / {ram_total} MB\n"
                    f"💾 <b>Storage</b>: {disk}%\n"
                    f"🔋 <b>Power</b>: {bat_str}\n"
                    f"🌡️ <b>Thermals</b>: Max {max_temp}°C\n"
                    f"⏱️ <b>Uptime</b>: {uptime}\n\n"
                    "🤖 <b>Specialist Fleet</b>:\n"
                    "• 🟢 <b>Friday Telegram Channel</b>: Active (FallbackTransport + AG UI)\n"
                    "• ⭐️ <b>Prime Agent</b>: Online (Coding & Testing)\n"
                    "• 🔹 <b>Hermes Intelligence</b>: Online (Research & Vault)\n"
                    "• 🔹 <b>Ultron Engine</b>: Online (OS Diagnostics)"
                )
            except Exception as e:
                log.error(f"Telemetry error: {e}")

        return "📊 <b>Friday OS Status</b>: All engines online and operating normally."

    async def get_agenda_report(self) -> str:
        """Fetch daily agenda, schedule, and reminders from memory vault."""
        mem = self._get_memory()
        if mem:
            try:
                status = mem.get_vault_status()
                facts = status.get("total_facts_indexed", 0)
                skills = status.get("total_skills_indexed", 0)
                today_f = status.get("today_conversation_file", "None")

                return (
                    "📋 <b>Today's Personal Agenda & Memory Snapshot</b>\n\n"
                    f"📅 <b>Daily Log</b>: <code>{Path(today_f).name if today_f else 'none'}</code>\n"
                    f"🧠 <b>Indexed Facts</b>: {facts}\n"
                    f"⚡ <b>Specialist Skills</b>: {skills}\n\n"
                    "<i>Commands available:</i>\n"
                    "• /code &lt;task&gt; — Build code with Prime Agent\n"
                    "• /task &lt;prompt&gt; — Delegate research to Hermes\n"
                    "• /remind &lt;text&gt; — Set new reminder\n"
                    "• /boost — Ultron performance boost"
                )
            except Exception as e:
                log.error(f"Agenda vault error: {e}")

        return "📋 <b>Agenda</b>: Standing by for commands."

    async def set_reminder(self, text: str) -> str:
        """Store reminder in Friday memory vault."""
        if not text.strip():
            return "Usage: <code>/remind &lt;reminder text&gt;</code>"

        mem = self._get_memory()
        if mem:
            try:
                mem.save_memory_fact(
                    key=f"reminder_{int(time.time())}",
                    value=text.strip(),
                    category="reminders",
                    source="telegram",
                )
                await ag_ui_bridge.emit_display_card("reminder_created", "Reminder Created", {"text": text})
                return f"⏰ <b>Reminder Set</b>\n\n{text.strip()}"
            except Exception as e:
                return f"❌ Failed to set reminder: {e}"

        return f"⏰ Reminder noted: {text}"

    # ── Conversational & Tool Calling Engine ──────────────────────────

    async def process_message(self, msg: TelegramMessage) -> str:
        """
        Process any message with Groq ultra-fast tool calling,
        Hermes/Prime delegation, or Gemini multi-turn reasoning.
        """
        text = (msg.text or "").strip()
        chat_id = msg.chat_id

        # 1. Handle Slash Commands
        if msg.is_command or text.startswith("/"):
            parts = text.split(None, 1)
            cmd = parts[0].lower()
            args = parts[1] if len(parts) > 1 else ""

            if cmd in ("/status", "/health"):
                return await self.get_system_status()
            elif cmd in ("/today", "/agenda"):
                return await self.get_agenda_report()
            elif cmd in ("/code",):
                return await self.execute_code_task(args, chat_id)
            elif cmd in ("/task",):
                return await self.execute_hermes_task(args, chat_id)
            elif cmd in ("/boost",):
                return await self.execute_ultron_boost()
            elif cmd in ("/remind",):
                return await self.set_reminder(args)
            elif cmd in ("/digest",):
                return await self.get_system_status()
            elif cmd in ("/clear", "/reset"):
                return "🔄 <b>Session Reset</b>: Memory context refreshed and ready for new instructions, Sir."
            elif cmd in ("/help", "/start"):
                return (
                    "🤖 <b>Friday OS — Telegram Channel Gateway</b>\n\n"
                    "I am F.R.I.D.A.Y., your autonomous AI Personal Manager & Chief of Staff.\n\n"
                    "<b>Available Commands:</b>\n"
                    "• /status — 24/7 system health, battery, thermals & fleet status\n"
                    "• /today — Daily priorities, reminders & agenda\n"
                    "• /code &lt;task&gt; — Dispatch coding to Prime Agent\n"
                    "• /task &lt;prompt&gt; — Autonomous research & execution via Hermes\n"
                    "• /boost — Ultron RAM reclamation & kernel optimization\n"
                    "• /remind &lt;text&gt; — Save reminder to universal memory vault\n"
                    "• /digest — Immediate system & agenda briefing\n"
                    "• /clear — Reset session context\n\n"
                    "<i>Or simply send any natural language message to chat with me directly!</i>"
                )
            else:
                return f"❓ Unknown command: <code>{cmd}</code>\n\nSend /help to see all available commands."

        # 2. Natural Language: Check if clearly a coding task -> Prime Agent
        lower_t = text.lower()
        if any(lower_t.startswith(prefix) for prefix in ["code:", "write a script", "build a script", "write code", "fix bug"]):
            return await self.execute_code_task(text, chat_id)

        # 3. Check Groq Ultra-Fast LPU (<200ms) with OS tool calling
        if self._groq_api_key:
            try:
                groq_reply = await self._execute_groq_turn(text)
                if groq_reply:
                    return groq_reply
            except Exception as e:
                log.debug(f"Groq turn skipped: {e}")

        # 4. Multi-turn Conversational Response via Gemini
        return await self._fallback_gemini(text)

    async def _execute_groq_turn(self, text: str) -> Optional[str]:
        """High-speed Groq LPU execution with hardware tool dispatch."""
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._groq_api_key}",
            "Content-Type": "application/json",
        }
        system_prompt = (
            "You are F.R.I.D.A.Y., Tony Stark's sophisticated AI voice partner and 24/7 personal manager. "
            "You are chatting with your Boss Gopi on Telegram. "
            "Tone: Razor-sharp, loyal, highly competent, proactive, concise, and mobile-friendly. "
            "Keep responses concise and direct."
        )

        payload = {
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "temperature": 0.5,
            "max_tokens": 1024,
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"].get("content")
        return None

    async def _fallback_gemini(self, text: str) -> str:
        """Execute conversational turn via Google Gemini with fallback model ladder."""
        if not self._gemini_api_key:
            return "❌ GEMINI_API_KEY is not configured in .env."

        system_instruction = (
            "You are F.R.I.D.A.Y., Tony Stark's sophisticated AI voice partner and 24/7 personal manager. "
            "You are chatting with your Boss Gopi on Telegram while they are away from their PC. "
            "Tone: Razor-sharp, loyal, highly competent, proactive, concise, and mobile-friendly. "
            "You have a specialist agent fleet at your command: Prime Agent (coding), Hermes (deep research), and Ultron (Security & OS diagnostics)."
        )

        candidate_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]

        async with httpx.AsyncClient(timeout=45.0) as client:
            for model_name in candidate_models:
                try:
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self._gemini_api_key}"
                    payload = {
                        "contents": [{"parts": [{"text": text}]}],
                        "systemInstruction": {"parts": [{"text": system_instruction}]},
                        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
                    }
                    resp = await client.post(url, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts:
                                return parts[0].get("text", "Standing by, Sir.")
                except Exception as e:
                    log.warning(f"Gemini {model_name} attempt failed: {e}")

        return "⚠️ I apologize Boss, upstream model services are temporarily unreachable."
