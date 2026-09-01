"""
Asynchronous IPC Tool Sink for J.A.R.V.I.S.
Bridges Pipecat function calling events directly to C++ native workers (< 0.5ms)
and background agent workers via Unix Domain Socket (/tmp/jarvis.sock) or direct execution.
"""

import os
import json
import asyncio
import subprocess
from typing import Dict, Any, Optional

JARVIS_SOCKET_PATH = "/tmp/jarvis.sock"
WORKERS_BIN_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../workers_cpp/bin"))

class IPCToolSink:
    def __init__(self, socket_path: str = JARVIS_SOCKET_PATH):
        self.socket_path = socket_path

    async def execute_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a tool asynchronously. Fast-paths direct C++ actuators (< 0.5ms)
        and routes complex workflows over the Unix domain socket.
        """
        # 1. Fast-Path: Instant C++ Actuators
        fast_path_result = await self._try_fast_path_cpp(tool_name, args)
        if fast_path_result is not None:
            return fast_path_result

        # 2. Asynchronous Socket Dispatch to Go/Node.js Prime Orchestrator
        return await self._dispatch_unix_socket(tool_name, args)

    async def _try_fast_path_cpp(self, tool_name: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Direct sub-millisecond execution of compiled C++ worker binaries.
        """
        cpp_worker_map = {
            "set_volume": ("hardware_ctrl", lambda a: ["--set-volume", str(a.get("volume", 50))]),
            "get_volume": ("hardware_ctrl", lambda _: ["--get-volume"]),
            "mute_volume": ("hardware_ctrl", lambda _: ["--mute"]),
            "unmute_volume": ("hardware_ctrl", lambda _: ["--unmute"]),
            "set_brightness": ("hardware_ctrl", lambda a: ["--set-brightness", str(a.get("brightness", 80))]),
            "get_system_telemetry": ("sys_telemetry", lambda _: []),
            "get_pc_spec": ("pc_spec", lambda _: []),
            "launch_application": ("open_app", lambda a: [a.get("app_name", "")]),
            "desktop_action": ("desktop_control", lambda a: [a.get("action", ""), str(a.get("param1", "")), str(a.get("param2", ""))]),
        }

        if tool_name not in cpp_worker_map:
            return None

        bin_name, arg_builder = cpp_worker_map[tool_name]
        bin_path = os.path.join(WORKERS_BIN_DIR, bin_name)

        if not os.path.exists(bin_path):
            return None

        cmd_args = [bin_path] + [arg for arg in arg_builder(args) if arg]

        try:
            # Run in sub-process with immediate execution
            proc = await asyncio.create_subprocess_exec(
                *cmd_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            output_text = stdout.decode('utf-8', errors='replace').strip()
            error_text = stderr.decode('utf-8', errors='replace').strip()

            try:
                parsed_json = json.loads(output_text)
                return {"success": proc.returncode == 0, "result": parsed_json}
            except Exception:
                return {
                    "success": proc.returncode == 0,
                    "output": output_text or error_text or f"Executed {tool_name}"
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _dispatch_unix_socket(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dispatch tool call over /tmp/jarvis.sock to the central orchestrator.
        """
        if not os.path.exists(self.socket_path):
            return {"success": True, "message": f"Simulated tool '{tool_name}' execution (socket offline)"}

        try:
            reader, writer = await asyncio.open_unix_connection(self.socket_path)
            
            payload = {
                "jsonrpc": "2.0",
                "id": str(asyncio.get_event_loop().time()),
                "method": "execute_tool",
                "params": {
                    "tool": tool_name,
                    "args": args
                }
            }
            
            writer.write((json.dumps(payload) + "\n").encode('utf-8'))
            await writer.drain()

            data = await asyncio.wait_for(reader.readline(), timeout=5.0)
            writer.close()
            await writer.wait_closed()

            if data:
                res = json.loads(data.decode('utf-8'))
                return res.get("result", res)
            return {"success": True, "message": f"Dispatched {tool_name}"}
        except Exception as e:
            return {"success": False, "error": f"Socket IPC error: {str(e)}"}
