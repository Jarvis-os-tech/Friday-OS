"""
Friday-OS Master Registry Loader for Python Core Engine.
Reads agents.registry.json to provide agent, skill, and tool introspection.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional

REGISTRY_PATH = os.path.join(os.getcwd(), "agents.registry.json")


class MasterRegistry:
    _instance = None

    @classmethod
    def get_instance(cls) -> "MasterRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self, path: str = REGISTRY_PATH):
        self.path = path
        self._data: Dict[str, Any] = {}
        self.reload()

    def reload(self):
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                self._data = json.load(f)
        else:
            self._data = {"agents": {}, "skills": {}, "tools": {}}

    @property
    def raw(self) -> Dict[str, Any]:
        return self._data

    def get_agents(self) -> List[Dict[str, Any]]:
        return list(self._data.get("agents", {}).values())

    def get_agent(self, agent_id: str) -> Optional[Dict[str, Any]]:
        return self._data.get("agents", {}).get(agent_id)

    def get_skills(self) -> List[Dict[str, Any]]:
        return list(self._data.get("skills", {}).values())

    def get_skill(self, skill_name: str) -> Optional[Dict[str, Any]]:
        return self._data.get("skills", {}).get(skill_name)

    def get_tools(self) -> Dict[str, Any]:
        return self._data.get("tools", {})

    def get_prompt_summary(self) -> str:
        """Returns a condensed markdown summary for injecting into Jinja2 prompt engine."""
        agents = self.get_agents()
        skills = self.get_skills()
        tools = self.get_tools()

        agent_lines = "\n".join(
            f"- **{a.get('name')}** (`{a.get('id')}`): {a.get('role')} [{', '.join(a.get('capabilities', []))}]"
            for a in agents
        )

        skill_lines = "\n".join(
            f"- `{s.get('name')}` ({s.get('category')}): {s.get('description')}"
            for s in skills
        )

        cpp_items = tools.get("cpp_workers", {}).get("items", {})

        return (
            "### 🛠️ Friday-OS Registered Capabilities\n"
            f"**Agents & Departments ({len(agents)}):**\n{agent_lines}\n\n"
            f"**Modular Skills ({len(skills)}):**\n{skill_lines}\n\n"
            f"**Hardware Workers:** {len(cpp_items)} compiled C++ binaries in `workers_cpp/bin/`.\n"
            "- Rust Audio Gateway (`/tmp/jarvis_audio.sock`)\n"
            "- Rust Memory Engine (`port 50051`)\n"
            "- Capability Forge (`bwrap` Sandbox)"
        )


master_registry = MasterRegistry.get_instance()
