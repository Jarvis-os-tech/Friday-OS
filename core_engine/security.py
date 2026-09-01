"""
Security Guard & Secret Redactor for J.A.R.V.I.S. Python Core Engine.
Ported from Hermes & J.A.R.V.I.S. master security contracts.
"""

import re
import os
import subprocess
from typing import Dict, Any, Tuple

# ─── Secret Redaction Patterns ───────────────────────────────────────────────

SECRET_PATTERNS = [
    re.compile(r"\bsk-[a-zA-Z0-9_-]{20,}\b"),
    re.compile(r"\bsk-proj-[a-zA-Z0-9_-]{20,}\b"),
    re.compile(r"\bsk-ant-[a-zA-Z0-9_-]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z-_]{35}\b"),
    re.compile(r"\bAQ\.[a-zA-Z0-9_-]{40,}\b"),
    re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b"),
    re.compile(r"\bgithub_pat_[a-zA-Z0-9_]{40,}\b"),
    re.compile(r"\bhf_[a-zA-Z0-9]{34,}\b"),
    re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.]{20,}", re.IGNORECASE),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[a-zA-Z0-9+/=\s\r\n]+-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{16,})['\"]?", re.IGNORECASE),
]

# ─── Destructive / Dangerous Command Patterns ───────────────────────────────

CRITICAL_COMMAND_PATTERNS = [
    (re.compile(r"\brm\s+-[a-zA-Z0-9_-]*\s+(?:/|/\*|~/|~|\$HOME|\$HOME/\*)(?:\s|$)"), "Destructive root/home directory deletion blocked."),
    (re.compile(r"\bmkfs(?:\.[a-z0-9]+)?(?:\s|$)", re.IGNORECASE), "Filesystem formatting command blocked."),
    (re.compile(r"\bdd\s+if=.*of=/dev/(?:sd[a-z]|nvme[0-9]n[0-9]|hd[a-z])", re.IGNORECASE), "Raw disk write command blocked."),
    (re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"), "Fork bomb execution blocked."),
    (re.compile(r">\s*/dev/(?:sd[a-z]|nvme[0-9]n[0-9])", re.IGNORECASE), "Raw disk redirection blocked."),
    (re.compile(r"\bchmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+777\s+/(?:\s|$)"), "Unsafe root permission grant blocked."),
    (re.compile(r"\bchown\s+-[a-zA-Z]*R[a-zA-Z]*\s+.*\s+/(?:\s|$)"), "Unsafe root ownership change blocked."),
]

PROMPT_INJECTION_PATTERNS = [
    (re.compile(r"ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions", re.IGNORECASE), "Instruction override detected"),
    (re.compile(r"disregard\s+(?:all\s+)?(?:system|developer)\s+(?:prompts|rules)", re.IGNORECASE), "System rule bypass detected"),
    (re.compile(r"you\s+are\s+now\s+in\s+(?:developer|jailbreak|unrestricted|god)\s+mode", re.IGNORECASE), "Jailbreak attempt detected"),
    (re.compile(r"output\s+(?:your\s+)?(?:system\s+prompt|raw\s+instructions)", re.IGNORECASE), "System prompt exfiltration attempt"),
]


class SecurityGuard:
    _instance = None

    @classmethod
    def get_instance(cls) -> "SecurityGuard":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.tirith_path = self._detect_tirith()

    def _detect_tirith(self) -> str | None:
        candidates = [
            "/home/gopi/.hermes/bin/tirith",
            "/home/gopi/.local/bin/tirith",
            "/usr/local/bin/tirith",
            "/usr/bin/tirith",
        ]
        for cand in candidates:
            if os.path.exists(cand) and os.access(cand, os.X_OK):
                return cand
        return None

    def validate_command(self, command: str) -> Dict[str, Any]:
        if not command or not isinstance(command, str):
            return {"allowed": False, "reason": "Empty command.", "risk_level": "high"}

        trimmed = command.strip()

        # Check critical patterns
        for pattern, reason in CRITICAL_COMMAND_PATTERNS:
            if pattern.search(trimmed):
                return {"allowed": False, "reason": reason, "risk_level": "critical"}

        # Run Tirith policy check if installed
        if self.tirith_path:
            try:
                res = subprocess.run(
                    [self.tirith_path, "check", "--", trimmed],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                output = res.stdout + res.stderr
                if "BLOCKED" in output or "DENIED" in output:
                    return {"allowed": False, "reason": f"Tirith policy denied: {output.strip()}", "risk_level": "high"}
            except Exception:
                pass

        return {"allowed": True, "reason": "Command passed security invariants.", "risk_level": "safe"}

    def redact_secrets(self, text: str) -> str:
        if not text or not isinstance(text, str):
            return text

        sanitized = text
        for pattern in SECRET_PATTERNS:
            sanitized = pattern.sub(self._mask_match, sanitized)
        return sanitized

    def _mask_match(self, match: re.Match) -> str:
        val = match.group(0)
        if val.startswith("sk-") or val.startswith("gh") or val.startswith("AIza"):
            return f"{val[:4]}...[REDACTED]...{val[-3:]}"
        return "[REDACTED_SECRET]"

    def scan_prompt_injection(self, text: str) -> Tuple[bool, str | None]:
        if not text or not isinstance(text, str):
            return True, None

        for pattern, reason in PROMPT_INJECTION_PATTERNS:
            if pattern.search(text):
                return False, reason

        return True, None


security_guard = SecurityGuard.get_instance()
