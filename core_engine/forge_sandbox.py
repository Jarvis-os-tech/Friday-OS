"""
Native Linux Sandbox & Isolated Execution Engine for J.A.R.V.I.S. Capability Forge.
Uses Bubblewrap (`bwrap`) chroot jail and isolated virtual environments to test and run
dynamically synthesized tools with zero credential leakage and strict timeout bounds.
"""

import os
import sys
import json
import shutil
import asyncio
import tempfile
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

CUSTOM_TOOLS_DIR = Path(os.getcwd()) / "custom_tools"
FORGE_VENV_DIR = CUSTOM_TOOLS_DIR / ".forge_venv"
BWRAP_BIN = shutil.which("bwrap") or "/usr/bin/bwrap"

# API keys and sensitive environment variables to purge from sandbox processes
SECRET_ENV_KEYS = [
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "NVIDIA_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "GITHUB_TOKEN",
    "LINKEDIN_TOKEN",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "HERMES_API_KEY",
    "ELEVENLABS_API_KEY",
    "DATABASE_URL",
]


class ForgeSandbox:
    def __init__(self):
        CUSTOM_TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        self.bwrap_available = os.path.exists(BWRAP_BIN) and os.access(BWRAP_BIN, os.X_OK)

    def get_clean_env(self, extra_env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Generate a sterile environment dictionary with all master secrets removed."""
        clean = os.environ.copy()
        for key in SECRET_ENV_KEYS:
            clean.pop(key, None)
        # Also remove any key containing SECRET, TOKEN, or KEY
        for k in list(clean.keys()):
            upper_k = k.upper()
            if "API_KEY" in upper_k or "SECRET" in upper_k or "TOKEN" in upper_k or "PASSWORD" in upper_k:
                clean.pop(k, None)

        clean["PYTHONUNBUFFERED"] = "1"
        clean["PYTHONDONTWRITEBYTECODE"] = "1"
        if extra_env:
            clean.update(extra_env)
        return clean

    def ensure_forge_venv(self) -> Path:
        """Ensure an isolated virtualenv exists for forged tools."""
        py_bin = FORGE_VENV_DIR / "bin" / "python3"
        if not py_bin.exists():
            FORGE_VENV_DIR.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [sys.executable, "-m", "venv", str(FORGE_VENV_DIR)],
                check=True,
                capture_output=True,
                text=True,
            )
        return py_bin

    async def install_requirements(self, requirements: List[str]) -> Tuple[bool, str]:
        """Install approved pip requirements into the forge venv."""
        if not requirements:
            return True, "No requirements to install."

        py_bin = self.ensure_forge_venv()
        pip_bin = FORGE_VENV_DIR / "bin" / "pip"

        clean_reqs = [r.strip() for r in requirements if r.strip()]
        if not clean_reqs:
            return True, "No valid requirements."

        cmd = [str(pip_bin), "install", "--disable-pip-version-check", *clean_reqs]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self.get_clean_env(),
            )
            stdout, stderr = await proc.communicate()
            out_str = stdout.decode("utf-8", errors="replace").strip()
            err_str = stderr.decode("utf-8", errors="replace").strip()
            if proc.returncode == 0:
                return True, out_str
            return False, f"Pip error: {err_str or out_str}"
        except Exception as e:
            return False, f"Failed to run pip: {str(e)}"

    def _build_bwrap_command(
        self,
        py_exec: str,
        script_path: str,
        script_args: List[str],
        work_dir: str,
        allow_network: bool = True,
    ) -> List[str]:
        """Construct a secure Bubblewrap jail invocation command."""
        cmd = [
            BWRAP_BIN,
            "--ro-bind", "/usr", "/usr",
            "--ro-bind", "/lib", "/lib",
            "--tmpfs", "/tmp",
            "--dir", work_dir,
            "--chdir", work_dir,
            "--unshare-all",
        ]

        if os.path.exists("/lib64"):
            cmd.extend(["--ro-bind", "/lib64", "/lib64"])
        if os.path.exists("/bin"):
            cmd.extend(["--ro-bind", "/bin", "/bin"])
        if os.path.exists("/etc/ssl"):
            cmd.extend(["--ro-bind", "/etc/ssl", "/etc/ssl"])
        if os.path.exists("/etc/resolv.conf"):
            cmd.extend(["--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf"])

        # Bind the forge venv if it exists
        if FORGE_VENV_DIR.exists():
            cmd.extend(["--ro-bind", str(FORGE_VENV_DIR), str(FORGE_VENV_DIR)])

        # Bind custom_tools directory (read-write for data and code execution)
        if CUSTOM_TOOLS_DIR.exists():
            cmd.extend(["--bind", str(CUSTOM_TOOLS_DIR), str(CUSTOM_TOOLS_DIR)])
            data_dir = CUSTOM_TOOLS_DIR / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            cmd.extend(["--bind", str(data_dir), str(data_dir)])

        # Bind workspace temporary execution directory
        cmd.extend(["--bind", work_dir, work_dir])

        if allow_network:
            cmd.append("--share-net")

        # Command to run inside jail
        cmd.extend([py_exec, script_path, *script_args])
        return cmd

    async def run_in_sandbox(
        self,
        script_code: str,
        args: Optional[List[str]] = None,
        timeout: float = 10.0,
        allow_network: bool = False,
        extra_env: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Execute arbitrary Python code in the sandbox (bwrap or sterile venv fallback).
        """
        args = args or []
        py_bin = str(self.ensure_forge_venv())

        with tempfile.TemporaryDirectory(prefix="jarvis_forge_") as temp_dir:
            temp_path = Path(temp_dir)
            script_file = temp_path / "main.py"
            script_file.write_text(script_code, encoding="utf-8")

            clean_env = self.get_clean_env(extra_env)

            if self.bwrap_available:
                cmd = self._build_bwrap_command(
                    py_exec=py_bin,
                    script_path=str(script_file),
                    script_args=args,
                    work_dir=str(temp_path),
                    allow_network=allow_network,
                )
            else:
                cmd = [py_bin, str(script_file), *args]

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(temp_path),
                    env=clean_env,
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                out_str = stdout.decode("utf-8", errors="replace").strip()
                err_str = stderr.decode("utf-8", errors="replace").strip()

                if proc.returncode == 0:
                    return {
                        "success": True,
                        "stdout": out_str,
                        "stderr": err_str,
                        "exit_code": 0,
                    }
                else:
                    return {
                        "success": False,
                        "stdout": out_str,
                        "stderr": err_str or f"Process failed with exit code {proc.returncode}",
                        "exit_code": proc.returncode,
                    }
            except asyncio.TimeoutError:
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Execution timed out after {timeout} seconds.",
                    "exit_code": -1,
                }
            except Exception as e:
                return {
                    "success": False,
                    "stdout": "",
                    "stderr": f"Sandbox execution error: {str(e)}",
                    "exit_code": -1,
                }

    async def verify_tool(
        self,
        tool_name: str,
        tool_code: str,
        test_code: str,
        requirements: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Synthetically verify a newly forged tool using its test suite in an isolated sandbox.
        """
        requirements = requirements or []
        # 1. Install requirements if needed
        if requirements:
            ok, pip_log = await self.install_requirements(requirements)
            if not ok:
                return {
                    "passed": False,
                    "error": f"Failed to install dependencies: {pip_log}",
                    "logs": pip_log,
                }

        # 2. Prepare test wrapper script
        test_wrapper = f"""
import sys
import json
from pathlib import Path

# Write tool code to temporary module
with open("{tool_name}.py", "w", encoding="utf-8") as f:
    f.write({json.dumps(tool_code)})

# Execute test code
{test_code}
print("\\n--- FORGE_TESTS_PASSED ---")
"""

        res = await self.run_in_sandbox(test_wrapper, timeout=15.0)
        passed = res["success"] and "--- FORGE_TESTS_PASSED ---" in res["stdout"]

        return {
            "passed": passed,
            "stdout": res["stdout"],
            "stderr": res["stderr"],
            "error": None if passed else (res["stderr"] or res["stdout"] or "Tests did not complete successfully."),
        }

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute an installed tool from `custom_tools/{tool_name}.py` in the secure sandbox.
        """
        tool_file = CUSTOM_TOOLS_DIR / f"{tool_name}.py"
        if not tool_file.exists():
            return {"success": False, "error": f"Custom tool '{tool_name}' not found."}

        runner_script = f"""
import sys
import json
import importlib.util
from pathlib import Path

tool_file = Path("{tool_file}")
spec = importlib.util.spec_from_file_location("{tool_name}", tool_file)
if not spec or not spec.loader:
    print(json.dumps({{"success": False, "error": "Cannot load tool spec"}}))
    sys.exit(1)

mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

if not hasattr(mod, "run"):
    print(json.dumps({{"success": False, "error": "Tool missing run() function"}}))
    sys.exit(1)

args = json.loads(sys.argv[1])
try:
    import asyncio
    import inspect
    if inspect.iscoroutinefunction(mod.run):
        result = asyncio.run(mod.run(**args))
    else:
        result = mod.run(**args)
    
    if isinstance(result, (dict, list)):
        print(json.dumps({{"success": True, "result": result}}))
    else:
        print(json.dumps({{"success": True, "result": str(result)}}))
except Exception as e:
    import traceback
    print(json.dumps({{"success": False, "error": str(e), "traceback": traceback.format_exc()}}))
"""

        res = await self.run_in_sandbox(
            runner_script,
            args=[json.dumps(arguments)],
            timeout=20.0,
        )

        if not res["success"]:
            return {"success": False, "error": res["stderr"] or "Tool execution failed in sandbox."}

        try:
            # Parse output from stdout
            lines = res["stdout"].strip().split("\n")
            for line in reversed(lines):
                line = line.strip()
                if line.startswith("{") and line.endswith("}"):
                    parsed = json.loads(line)
                    if "success" in parsed:
                        return parsed
            return {"success": True, "result": res["stdout"]}
        except Exception:
            return {"success": True, "result": res["stdout"]}


forge_sandbox = ForgeSandbox()
