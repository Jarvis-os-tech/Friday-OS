"""
Gemini Live Bidirectional WebSocket Client for J.A.R.V.I.S.
Handles real-time 16kHz audio input, 24kHz response audio, tool calling, and interruptions.
"""

import os
import json
import base64
import asyncio
import time
import websockets
from typing import Optional, Callable, Dict, Any, List
from .prompt_engine import prompt_engine
from .actuator_dispatcher import actuator_dispatcher
from .audio_bridge import audio_bridge
from .memory import memory_engine

GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
DEFAULT_MODEL = "models/gemini-3.1-flash-live-preview"


class GeminiLiveSession:
    def __init__(self, api_key: Optional[str] = None, model: str = DEFAULT_MODEL, voice_name: str = "Puck"):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.model = model
        self.voice_name = voice_name
        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.is_connected = False
        self.is_running = False
        self.listeners: List[Callable[[Dict[str, Any]], None]] = []
        self._greeted = False
        self.session_resumption_handle: Optional[str] = None

    def add_listener(self, listener: Callable[[Dict[str, Any]], None]):
        if listener not in self.listeners:
            self.listeners.append(listener)

    def remove_listener(self, listener: Callable[[Dict[str, Any]], None]):
        if listener in self.listeners:
            self.listeners.remove(listener)

    def _emit(self, event: Dict[str, Any]):
        for cb in self.listeners:
            try:
                cb(event)
            except Exception:
                pass

    async def connect(self, voice_name: Optional[str] = None, custom_system_instruction: Optional[str] = None):
        self._greeted = False
        if not self.api_key:
            self.api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

        if not self.api_key:
            print("[GeminiLive] ⚠️ No GEMINI_API_KEY found. Running in offline/mock mode.")
            return

        if voice_name:
            self.voice_name = voice_name

        url = f"{GEMINI_WS_URL}?key={self.api_key}"
        print(f"[GeminiLive] 🎙 Connecting to Gemini Live API ({self.model}, voice: {self.voice_name})...")

        try:
            self.ws = await websockets.connect(url, max_size=15_000_000)
            self.is_connected = True
            self.is_running = True

            # Send Setup handshake
            await self._send_setup(custom_system_instruction)

            # Start message receiver task
            asyncio.create_task(self._receive_loop())
            # Start audio sender task from Rust audio bridge queue
            asyncio.create_task(self._audio_sender_loop())

        except Exception as e:
            print(f"[GeminiLive] Connection error: {e}")
            self.is_connected = False

    async def _send_setup(self, custom_system_instruction: Optional[str] = None):
        system_instruction = custom_system_instruction or prompt_engine.render_system_prompt(persona_id="friday")
        tools = actuator_dispatcher.get_tool_declarations()

        setup_msg = {
            "setup": {
                "model": self.model,
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {
                                "voiceName": self.voice_name
                            }
                        }
                    }
                },
                "systemInstruction": {
                    "parts": [{"text": system_instruction}]
                },
                "tools": [{"functionDeclarations": tools}],
                # Ultra-low latency voice activity detection
                "realtimeInputConfig": {
                    "automaticActivityDetection": {
                        "disabled": False,
                        "startOfSpeechSensitivity": 1,  # HIGH
                        "endOfSpeechSensitivity": 1,    # HIGH
                        "prefixPaddingMs": 40,
                        "silenceDurationMs": 180
                    }
                },
                "inputAudioTranscription": {},
                "outputAudioTranscription": {},
                "sessionResumption": {"handle": self.session_resumption_handle} if self.session_resumption_handle else {},
                "contextWindowCompression": {"slidingWindow": {}}
            }
        }
        await self.ws.send(json.dumps(setup_msg))
        print("[GeminiLive] ⚡ Setup handshake sent with Telgish prompt and tool manifests.")

    async def _audio_sender_loop(self):
        """
        Continuously pulls 16kHz PCM audio from AudioBridge and streams to Gemini Live.
        """
        try:
            while self.is_running and self.is_connected:
                pcm_chunk = await audio_bridge.inbound_audio_queue.get()
                if not pcm_chunk or not self.ws:
                    continue

                b64_audio = base64.b64encode(pcm_chunk).decode("utf-8")
                await self.send_realtime_audio(b64_audio)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[GeminiLive] Audio sender error: {e}")

    async def send_realtime_audio(self, b64_audio: str):
        if not self.ws or not self.is_connected:
            return
        msg = {
            "realtimeInput": {
                "audio": {
                    "mimeType": "audio/pcm;rate=16000",
                    "data": b64_audio
                }
            }
        }
        await self.ws.send(json.dumps(msg))

    async def send_realtime_image(self, b64_image: str, mime_type: str = "image/jpeg"):
        if not self.ws or not self.is_connected:
            return
        msg = {
            "realtimeInput": {
                "video": {
                    "mimeType": mime_type,
                    "data": b64_image
                }
            }
        }
        await self.ws.send(json.dumps(msg))

    async def _receive_loop(self):
        """
        Handles incoming Gemini Live WebSocket frames (audio chunks, tool calls, text turns).
        """
        try:
            async for raw_msg in self.ws:
                data = json.loads(raw_msg)

                if "setupComplete" in data:
                    print("[GeminiLive] 🌟 Gemini Live Bidirectional Session Active & Synchronized.")
                    self._emit({"type": "setup_complete"})
                    if not self._greeted:
                        self._greeted = True
                        asyncio.create_task(self.send_text_message("Good day Sir. Please state a crisp, sharp 1-sentence greeting to your operator (e.g. 'Good day, Sir. J.A.R.V.I.S. core online. How may I assist you today?')."))

                if "goAway" in data or "goaway" in data:
                    print("[GeminiLive] 🔄 GoAway signal received. Gracefully closing and refreshing session...")
                    self.is_connected = False
                    if self.ws:
                        try:
                            await self.ws.close()
                        except Exception:
                            pass
                    # Auto-reconnect cleanly with backoff (aligns with Rust bridge 1s->30s)
                    async def _reconnect():
                        await asyncio.sleep(1)
                        await self.connect(self.voice_name)
                    asyncio.create_task(_reconnect())
                    return

                # Session resumption handle (2h window)
                if "sessionResumptionUpdate" in data:
                    upd = data["sessionResumptionUpdate"]
                    handle = upd.get("newHandle") or upd.get("handle")
                    if handle:
                        self.session_resumption_handle = handle

                # Transcriptions (when enabled)
                server_content = data.get("serverContent")
                if server_content:
                    inp_tr = server_content.get("inputTranscription")
                    if inp_tr and inp_tr.get("text"):
                        txt = inp_tr["text"]
                        self._emit({"type": "input_transcription", "text": txt})
                        memory_engine.log_conversation_turn("User (Gopi)", txt, role="user")
                    out_tr = server_content.get("outputTranscription")
                    if out_tr and out_tr.get("text"):
                        self._emit({"type": "output_transcription", "text": out_tr["text"]})

                # 1. Handle Model Audio Turn
                server_content = data.get("serverContent")
                if server_content:
                    model_turn = server_content.get("modelTurn")
                    if model_turn:
                        for part in model_turn.get("parts", []):
                            inline_data = part.get("inlineData")
                            if inline_data and "audio" in inline_data.get("mimeType", ""):
                                raw_b64 = inline_data["data"]
                                raw_pcm = base64.b64decode(raw_b64)

                                # Forward to React UI WebSocket listeners
                                self._emit({"type": "audio", "audio": raw_b64, "data": raw_b64})

                                # Forward to Rust audio gateway speaker queue (if active)
                                if audio_bridge.client_writer:
                                    await audio_bridge.queue_playback(raw_pcm)

                            if "text" in part:
                                text = part["text"]
                                self._emit({"type": "transcript", "text": text, "role": "agent"})
                                self._emit({"type": "output_transcription", "text": text})
                                memory_engine.log_conversation_turn("Friday", text, role="assistant")

                    if server_content.get("interrupted"):
                        print("[GeminiLive] ⚡ Voice output interrupted by operator.")
                        audio_bridge.clear_playback()
                        self._emit({"type": "interrupted"})

                    if server_content.get("turnComplete"):
                        self._emit({"type": "turn_complete"})

                # 2. Handle Tool Calls Concurrently
                tool_call = data.get("toolCall")
                if tool_call:
                    # Spawn tool execution in background task so receive/audio loop NEVER blocks
                    asyncio.create_task(self._process_tool_call_concurrently(tool_call))

        except Exception as e:
            print(f"[GeminiLive] Receiver error: {e}")
            self.is_connected = False

    async def _process_tool_call_concurrently(self, tool_call: Dict[str, Any]):
        """
        Executes tools in parallel while audio streaming continues uninterrupted.
        """
        try:
            function_calls = tool_call.get("functionCalls", [])
            if not function_calls:
                return

            async def _execute_single(call: Dict[str, Any]) -> Dict[str, Any]:
                call_id = call.get("id")
                name = call.get("name")
                args = call.get("args", {})
                start_ms = time.time() * 1000
                print(f"[GeminiLive] ⚡ Simultaneous Tool Execution: {name}({args})")
                self._emit({"type": "tool_call", "name": name, "toolName": name, "args": args})

                try:
                    result = await actuator_dispatcher.dispatch_tool(name, args)
                except Exception as ex:
                    result = {"success": False, "error": str(ex)}

                duration_ms = (time.time() * 1000) - start_ms
                self._emit({"type": "tool_result", "toolName": name, "result": result})
                memory_engine.log_tool_execution(name, args, result, duration_ms)
                return {
                    "id": call_id,
                    "name": name,
                    "response": {"output": result}
                }

            # Run all simultaneous tool calls concurrently in parallel
            responses = await asyncio.gather(*[_execute_single(c) for c in function_calls])

            if self.ws and self.is_connected:
                tool_resp_msg = {
                    "toolResponse": {
                        "functionResponses": list(responses)
                    }
                }
                await self.ws.send(json.dumps(tool_resp_msg))
                print(f"[GeminiLive] ⚡ Tool response sent for {len(responses)} call(s).")
        except Exception as e:
            print(f"[GeminiLive] Error processing concurrent tool call: {e}")

    async def send_text_message(self, text: str):
        if not self.ws or not self.is_connected:
            return

        if not text.startswith("Good day Sir. Please state a crisp"):
            memory_engine.log_conversation_turn("User (Gopi)", text, role="user")

        msg = {
            "clientContent": {
                "turns": [
                    {
                        "role": "user",
                        "parts": [{"text": text}]
                    }
                ],
                "turnComplete": True
            }
        }
        await self.ws.send(json.dumps(msg))

    async def close(self):
        self.is_running = False
        self.is_connected = False
        if self.ws:
            await self.ws.close()
        print("[GeminiLive] Session closed.")


gemini_session = GeminiLiveSession()
