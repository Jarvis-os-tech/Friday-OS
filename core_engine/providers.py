"""
Friday-OS — LLM Provider Management & Omniroute Integration Subsystem
Provides sovereign, multi-provider LLM routing (Omniroute, Gemini, Groq)
with persistent runtime state, tool calling support, and Telegram dynamic switching.
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import httpx
from dotenv import load_dotenv

log = logging.getLogger("friday.providers")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"
_CONFIG_FILE = _PROJECT_ROOT / "data" / "llm_config.json"


class LLMProvider:
    """Base class for Friday-OS LLM providers."""

    def __init__(
        self,
        name: str,
        display_name: str,
        base_url: str,
        api_key: str,
        default_model: str,
        available_models: List[str],
        description: str = "",
    ):
        self.name = name
        self.display_name = display_name
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.api_key = api_key.strip().strip("\"'") if api_key else ""
        self.default_model = default_model
        self.available_models = available_models
        self.description = description

    def is_configured(self) -> bool:
        return bool(self.base_url or self.api_key)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "base_url": self.base_url,
            "has_api_key": bool(self.api_key),
            "default_model": self.default_model,
            "available_models": self.available_models,
            "description": self.description,
            "configured": self.is_configured(),
        }

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.4,
        max_tokens: int = 2048,
    ) -> Dict[str, Any]:
        """Execute chat completion request. Returns OpenAI-compatible response dictionary."""
        raise NotImplementedError


class OmnirouteProvider(LLMProvider):
    """
    Omniroute Sovereign LLM Gateway Provider for Friday-OS.
    Routes queries to local/remote Omniroute router with OpenAI-compatible API,
    supporting auto-routing, best-coding, reasoning, and multi-model fallbacks.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
    ):
        url = (
            base_url
            or os.getenv("OMNIROUTE_BASE_URL")
            or os.getenv("OMNIROUTE_URL")
            or "http://127.0.0.1:20128/v1"
        )
        key = api_key or os.getenv("OMNIROUTE_API_KEY", "")
        model = default_model or os.getenv("OMNIROUTE_MODEL", "auto/best-coding")

        models = [
            "auto/best-coding",
            "auto/reasoning",
            "deepseek-r1",
            "deepseek-v3",
            "claude-3-7-sonnet",
            "claude-3-5-sonnet",
            "gpt-4o",
            "gpt-4o-mini",
            "gemini-2.5-flash",
            "qwen-2.5-coder-32b",
            "llama-3.3-70b-instruct",
        ]

        super().__init__(
            name="omniroute",
            display_name="Omniroute Gateway",
            base_url=url,
            api_key=key,
            default_model=model,
            available_models=models,
            description="High-speed sovereign AI router with intelligent model switching and coding pipelines.",
        )

    def is_configured(self) -> bool:
        return bool(self.base_url)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> Dict[str, Any]:
        target_model = model or self.default_model
        endpoint = f"{self.base_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload: Dict[str, Any] = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Omniroute returned HTTP {resp.status_code}: {resp.text[:300]}"
                )
            return resp.json()


class GeminiProvider(LLMProvider):
    """Google Gemini Direct Provider for Friday-OS."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
    ):
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
        model = default_model or "gemini-3.7-flash"
        models = [
            "gemini-3.7-flash",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-2.5-pro",
        ]

        super().__init__(
            name="gemini",
            display_name="Google Gemini",
            base_url="https://generativelanguage.googleapis.com/v1beta",
            api_key=key,
            default_model=model,
            available_models=models,
            description="Google Gemini multimodal intelligence via official generative language endpoints.",
        )

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.5,
        max_tokens: int = 2048,
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        target_model = model or self.default_model

        # Extract system prompt if present
        system_text = ""
        contents = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "system":
                system_text += f"{content}\n"
            elif role in ("user", "human"):
                contents.append({"role": "user", "parts": [{"text": content}]})
            elif role in ("assistant", "model"):
                contents.append({"role": "model", "parts": [{"text": content}]})

        if not contents:
            contents = [{"role": "user", "parts": [{"text": "Hello"}]}]

        url = f"{self.base_url}/models/{target_model}:generateContent?key={self.api_key}"
        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_text.strip():
            payload["systemInstruction"] = {"parts": [{"text": system_text.strip()}]}

        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Gemini API returned HTTP {resp.status_code}: {resp.text[:300]}"
                )
            data = resp.json()
            candidates = data.get("candidates", [])
            reply_text = ""
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    reply_text = parts[0].get("text", "")

            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": reply_text,
                        }
                    }
                ]
            }


class GroqProvider(LLMProvider):
    """Groq Cloud Ultra-Fast Provider for Friday-OS."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
    ):
        key = api_key or os.getenv("GROQ_API_KEY") or os.getenv("qroq_API_KEY") or ""
        model = default_model or "llama-3.3-70b-versatile"
        models = [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
            "deepseek-r1-distill-llama-70b",
        ]

        super().__init__(
            name="groq",
            display_name="Groq Cloud",
            base_url="https://api.groq.com/openai/v1",
            api_key=key,
            default_model=model,
            available_models=models,
            description="Ultra-low latency inference engine powered by Groq LPU hardware.",
        )

    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.4,
        max_tokens: int = 2048,
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY is not configured.")

        target_model = model or self.default_model
        endpoint = f"{self.base_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": target_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(endpoint, json=payload, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Groq API returned HTTP {resp.status_code}: {resp.text[:300]}"
                )
            return resp.json()


class ProviderManager:
    """
    Central LLM Provider & Model Configuration Manager for Friday-OS.
    Manages active provider, model selections, persistence, and live switching.
    """

    _instance = None

    @classmethod
    def get_instance(cls) -> "ProviderManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.reload_env()
        self._providers: Dict[str, LLMProvider] = {
            "omniroute": OmnirouteProvider(),
            "gemini": GeminiProvider(),
            "groq": GroqProvider(),
        }

        self._active_provider_name = "omniroute"
        self._active_model_name = "auto/best-coding"
        self._load_saved_config()

    def reload_env(self):
        """Reload variables from .env file."""
        if _ENV_FILE.exists():
            load_dotenv(_ENV_FILE, override=True)

    def _load_saved_config(self):
        """Load persistent LLM provider and model configuration from JSON file or .env."""
        # 1. Start with defaults from environment
        env_provider = os.getenv("ACTIVE_LLM_PROVIDER", "omniroute").strip().lower()
        env_model = os.getenv("ACTIVE_LLM_MODEL", "").strip()

        if env_provider in self._providers:
            self._active_provider_name = env_provider
        else:
            self._active_provider_name = "omniroute"

        if env_model:
            self._active_model_name = env_model
        else:
            self._active_model_name = self._providers[self._active_provider_name].default_model

        # 2. Override with JSON persistence file if present
        if _CONFIG_FILE.exists():
            try:
                data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
                saved_provider = (data.get("active_provider") or "").lower()
                saved_model = data.get("active_model") or ""

                if saved_provider in self._providers:
                    self._active_provider_name = saved_provider
                if saved_model:
                    self._active_model_name = saved_model
            except Exception as e:
                log.warning(f"Could not read LLM config file: {e}")

    def _save_config(self):
        """Persist current LLM provider and model configuration to JSON file."""
        try:
            _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "active_provider": self._active_provider_name,
                "active_model": self._active_model_name,
                "updated_at": Path().stat().st_mtime if Path().exists() else 0,
            }
            _CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            log.error(f"Failed to save LLM config: {e}")

    def get_providers(self) -> Dict[str, LLMProvider]:
        return self._providers

    def get_active_provider(self) -> LLMProvider:
        return self._providers.get(self._active_provider_name, self._providers["omniroute"])

    def get_active_model(self) -> str:
        return self._active_model_name

    def set_provider(self, provider_name: str) -> Tuple[bool, str]:
        """Switch active LLM provider."""
        p_name = provider_name.strip().lower()
        if p_name not in self._providers:
            valid = ", ".join(f"`{k}`" for k in self._providers.keys())
            return False, f"Unknown provider `{provider_name}`. Available providers: {valid}"

        self._active_provider_name = p_name
        # Reset to provider's default model if current model is not in new provider's list
        provider = self._providers[p_name]
        if self._active_model_name not in provider.available_models:
            self._active_model_name = provider.default_model

        self._save_config()
        return True, f"✅ Provider switched to **{provider.display_name}** (`{p_name}`) with model `{self._active_model_name}`."

    def set_model(self, model_name: str, provider_name: Optional[str] = None) -> Tuple[bool, str]:
        """Switch active model. If provider is specified or model belongs to a known provider, switch both."""
        m_name = model_name.strip()
        if not m_name:
            return False, "Model name cannot be empty."

        if provider_name:
            p_name = provider_name.strip().lower()
            if p_name not in self._providers:
                valid = ", ".join(f"`{k}`" for k in self._providers.keys())
                return False, f"Unknown provider `{provider_name}`. Available providers: {valid}"
            self._active_provider_name = p_name

        # Auto-detect provider if model unambiguously matches another provider
        current_p = self.get_active_provider()
        if m_name not in current_p.available_models and not provider_name:
            for p_key, p_inst in self._providers.items():
                if m_name in p_inst.available_models:
                    self._active_provider_name = p_key
                    break

        self._active_model_name = m_name
        self._save_config()
        p = self.get_active_provider()
        return True, f"✅ Active Model set to `{m_name}` on **{p.display_name}** (`{p.name}`)."

    def set_provider_and_model(self, provider_name: str, model_name: str) -> Tuple[bool, str]:
        """Set both provider and model simultaneously."""
        return self.set_model(model_name, provider_name=provider_name)

    def get_status_card(self) -> str:
        """Format an informative Markdown status summary for Telegram."""
        active_p = self.get_active_provider()
        active_m = self.get_active_model()

        msg = (
            "🧠 **Friday OS — LLM & Provider Configuration**\n\n"
            f"🟢 **Active Provider:** `{active_p.name}` ({active_p.display_name})\n"
            f"⚡ **Active Model:** `{active_m}`\n"
        )
        if active_p.base_url:
            msg += f"🌐 **Endpoint:** `{active_p.base_url}`\n"

        msg += "\n━━━━━━━━━━━━━━━━━━━━━\n"
        msg += "📋 **Available Providers & Preset Models:**\n\n"

        for key, p in self._providers.items():
            is_cur = " 👈 *(Active)*" if key == active_p.name else ""
            status_icon = "🟢" if p.is_configured() else "⚪"
            msg += f"{status_icon} **{p.display_name}** (`{key}`){is_cur}\n"
            if p.base_url and key == "omniroute":
                msg += f"   • URL: `{p.base_url}`\n"
            preset_str = ", ".join(f"`{m}`" for m in p.available_models[:5])
            msg += f"   • Models: {preset_str}\n\n"

        msg += "━━━━━━━━━━━━━━━━━━━━━\n"
        msg += "💡 **How to switch:**\n"
        msg += "• `/model <model_name>` — Switch model on current provider\n"
        msg += "• `/model <provider> <model>` — e.g. `/model omniroute deepseek-r1`\n"
        msg += "• `/provider <name>` — e.g. `/provider omniroute` or `/provider gemini`\n"
        msg += "• Or type custom model string directly."

        return msg


# Global singleton instance
llm_manager = ProviderManager.get_instance()
