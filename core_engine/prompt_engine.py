"""
Prompt Engine for J.A.R.V.I.S. Python Core.
Renders Telgish & Multi-Agent system instructions via Jinja2 with live telemetry and memory snapshots.
"""

import os
import jinja2
from typing import Dict, Any
from .memory import memory_engine
from .actuator_dispatcher import actuator_dispatcher

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "templates")


class PromptEngine:
    _instance = None

    @classmethod
    def get_instance(cls) -> "PromptEngine":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(TEMPLATE_DIR),
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True
        )

    def _get_live_telemetry(self) -> Dict[str, Any]:
        mem_free_mb = 4096
        cpu_temp = "Normal"

        # Read /proc/meminfo
        try:
            with open("/proc/meminfo", "r") as f:
                lines = f.readlines()
                for line in lines:
                    if "MemAvailable:" in line:
                        kb = int(line.split()[1])
                        mem_free_mb = round(kb / 1024)
                        break
        except Exception:
            pass

        # Read thermal zone
        try:
            temp_path = "/sys/class/thermal/thermal_zone0/temp"
            if os.path.exists(temp_path):
                with open(temp_path, "r") as f:
                    milli = int(f.read().strip())
                    cpu_temp = f"{round(milli / 1000, 1)}°C"
        except Exception:
            pass

        return {
            "os_platform": "Ubuntu Linux (Native C++ & Rust Gateway)",
            "memory_free_mb": mem_free_mb,
            "cpu_temp": cpu_temp,
        }

    def render_system_prompt(self, persona_id: str = "friday", custom_context: Dict[str, Any] = None) -> str:
        telemetry = self._get_live_telemetry()
        memory_snapshot = memory_engine.get_frozen_snapshot()
        tools = actuator_dispatcher.get_tool_declarations()

        # Persona Configurations
        persona_configs = {
            "friday": {
                "template": "system_prompt.j2",
                "persona_name": "FRIDAY",
                "persona_role": "Sovereign AI Chief of Staff, Lead Systems Architect & Tactical Operating Partner",
                "language": "ENGLISH",
            },
            "jarvis": {
                "template": "system_prompt.j2",
                "persona_name": "FRIDAY",
                "persona_role": "Sovereign AI Chief of Staff & Tactical Operating Partner",
                "language": "TELGISH",
            },
            "hermes": {
                "template": "system_prompt_hermes.j2",
                "persona_name": "HERMES",
                "persona_role": "Autonomous AI Orchestrator & Task Execution Specialist",
                "language": "ENGLISH",
            },
            "ultron": {
                "template": "system_prompt.j2",
                "persona_name": "ULTRON",
                "persona_role": "Chief Security Officer & Threat Auditor",
                "language": "ENGLISH",
            },
            "edith": {
                "template": "system_prompt.j2",
                "persona_name": "EDITH",
                "persona_role": "Global Research & Data Extraction Lead",
                "language": "ENGLISH",
            },
            "karen": {
                "template": "system_prompt.j2",
                "persona_name": "KAREN",
                "persona_role": "Tactical Operations & Media Orchestrator",
                "language": "ENGLISH",
            },
        }

        config = persona_configs.get(persona_id.lower() if persona_id else "friday", persona_configs["friday"])
        template = self.env.get_template(config["template"])

        context = {
            "operator_name": "Gopi",
            "persona_name": config["persona_name"],
            "persona_role": config["persona_role"],
            "persona_language": config["language"],
            "total_tools": len(tools),
            "memory_snapshot": memory_snapshot["formatted_prompt"],
            **telemetry
        }

        if custom_context:
            context.update(custom_context)

        return template.render(**context).strip()


prompt_engine = PromptEngine.get_instance()
