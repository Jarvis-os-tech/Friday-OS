"""
Unix Domain Socket Audio Bridge for J.A.R.V.I.S.
Listens on /tmp/jarvis_audio.sock for 16kHz PCM from Rust CPAL Gateway,
and forwards 24kHz PCM from Gemini Live back to the Rust gateway.
"""

import os
import asyncio
import struct
from typing import Optional, Callable

DEFAULT_SOCKET_PATH = "/tmp/jarvis_audio.sock"
FRAME_HEADER_SIZE = 4  # 4-byte little-endian length prefix


class AudioBridge:
    def __init__(self, socket_path: str = DEFAULT_SOCKET_PATH):
        self.socket_path = socket_path
        self.server: Optional[asyncio.AbstractServer] = None
        self.client_writer: Optional[asyncio.StreamWriter] = None
        self.inbound_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self.outbound_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self.is_running = False
        self._on_audio_chunk: Optional[Callable[[bytes], None]] = None

    def set_audio_chunk_callback(self, callback: Callable[[bytes], None]):
        self._on_audio_chunk = callback

    async def start(self):
        # Clean up stale socket file if it exists
        if os.path.exists(self.socket_path):
            try:
                os.unlink(self.socket_path)
            except OSError:
                pass

        self.is_running = True
        self.server = await asyncio.start_unix_server(
            self._handle_client,
            path=self.socket_path
        )
        print(f"[AudioBridge] 🎙 Unix Domain Socket server listening on {self.socket_path}")

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        print("[AudioBridge] 🔗 Rust Audio Gateway connected via Unix Domain Socket.")
        self.client_writer = writer

        # Start downstream playback loop for this client
        playback_task = asyncio.create_task(self._playback_sender(writer))

        try:
            while self.is_running and not reader.at_eof():
                # Read 4-byte payload length prefix (LE)
                len_bytes = await reader.readexactly(FRAME_HEADER_SIZE)
                if not len_bytes:
                    break
                payload_len = struct.unpack("<I", len_bytes)[0]
                if payload_len == 0:
                    continue

                pcm_data = await reader.readexactly(payload_len)
                if not pcm_data:
                    break

                # Dispatch to queue and callback
                if self._on_audio_chunk:
                    self._on_audio_chunk(pcm_data)

                if self.inbound_audio_queue.full():
                    try:
                        self.inbound_audio_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                await self.inbound_audio_queue.put(pcm_data)

        except asyncio.IncompleteReadError:
            print("[AudioBridge] Client disconnected (EOF).")
        except Exception as e:
            print(f"[AudioBridge] Socket read error: {e}")
        finally:
            playback_task.cancel()
            self.client_writer = None
            writer.close()
            await writer.wait_closed()
            print("[AudioBridge] Client connection closed.")

    async def _playback_sender(self, writer: asyncio.StreamWriter):
        """
        Pulls 24kHz response audio bytes from outbound queue and writes them to Rust gateway.
        """
        try:
            while self.is_running:
                pcm_chunk = await self.outbound_audio_queue.get()
                if not pcm_chunk:
                    continue
                # Write length prefix
                header = struct.pack("<I", len(pcm_chunk))
                writer.write(header + pcm_chunk)
                await writer.drain()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[AudioBridge] Playback sender error: {e}")

    async def queue_playback(self, pcm_bytes: bytes):
        """
        Enqueues response audio to be played by the Rust gateway.
        """
        if self.outbound_audio_queue.full():
            try:
                self.outbound_audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        await self.outbound_audio_queue.put(pcm_bytes)

    def clear_playback(self):
        """
        Immediately clears all queued playback chunks on barge-in / user interruption.
        """
        cleared_count = 0
        while not self.outbound_audio_queue.empty():
            try:
                self.outbound_audio_queue.get_nowait()
                cleared_count += 1
            except asyncio.QueueEmpty:
                break
        if cleared_count > 0:
            print(f"[AudioBridge] ⚡ Flushed {cleared_count} pending audio chunk(s) on interruption.")

    async def stop(self):
        self.is_running = False
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        if os.path.exists(self.socket_path):
            try:
                os.unlink(self.socket_path)
            except OSError:
                pass
        print("[AudioBridge] Stopped and cleaned up socket.")


audio_bridge = AudioBridge()
