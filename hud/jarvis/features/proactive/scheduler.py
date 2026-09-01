"""
Proactive Scheduler — from Hermes SOUL.md:107 + hermes-agent/tools/cronjob_tools.py
Never-lose-data loops that run continuously even when voice is idle.

Origin:
  - SOUL.md:107 Daily loop 06:00 morning brief → 03:00 DeFi/MEV
  - cronjob_tools.py:cronjob(action="create", schedule, prompt, job_id)
  - tools/cronjob_tools.py supports croniter + gateway persistence

Present-dir wrapper: installs 5 JARVIS jobs into Hermes cron or falls back to APScheduler.
"""
from pathlib import Path
from typing import List, Dict

# Jobs mirror SOUL.md:107 + orchestrator/brain.py:PROACTIVE_JOBS
PROACTIVE_JOBS = [
    {"id": "morning_brief", "schedule": "0 6 * * *", "prompt": "Generate morning brief: overnight P&L, fleet health, calendar, anomalies", "desc": "06:00 brief — Hermes SOUL.md:109"},
    {"id": "midday_review", "schedule": "0 12 * * *", "prompt": "Mid-day review: content performance, lead pipeline, infra alerts", "desc": "12:00 review — SOUL.md:112"},
    {"id": "evening_synthesis", "schedule": "0 20 * * *", "prompt": "Evening synthesis: what learned today, tomorrow priorities", "desc": "20:00 synthesis — SOUL.md:115"},
    {"id": "vault_commit", "schedule": "*/5 * * * *", "prompt": "Commit Obsidian vault git auto-commit (never lose data)", "desc": "Every 5m vault git — obsidian_writer.py:git_commit_vault"},
    {"id": "daily_synthesis", "schedule": "0 22 * * *", "prompt": "Synthesize Conversations into Daily-Logs via memory_manager.synthesize_daily", "desc": "22:00 Daily-Logs — memory/search.py"},
]

def get_proactive_jobs() -> List[Dict]:
    return PROACTIVE_JOBS

def install_cron_jobs(jarvis_url: str = "http://localhost:8001") -> bool:
    """Install into Hermes cron (hermes-agent/tools/cronjob_tools.py). Falls back to no-op if hermes not running."""
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.cronjob_tools import cronjob
        for j in PROACTIVE_JOBS:
            try:
                res = cronjob(action="create", schedule=j["schedule"], prompt=j["prompt"], job_id=j["id"])
                print(f"[proactive] {j['id']}: {res[:200]}")
            except Exception as e:
                print(f"[proactive] {j['id']} skip: {e}")
        return True
    except Exception as e:
        print(f"[proactive] Hermes cron unavailable ({e}) — use config/jarvis.yaml fallback")
        return False

def list_jobs():
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.cronjob_tools import cronjob
        return cronjob(action="list")
    except Exception as e:
        return f"cron unavailable: {e}"

if __name__ == "__main__":
    print(get_proactive_jobs())
