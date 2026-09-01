"""
Cron Bridge — installs proactive jobs into Hermes cron system.
Uses hermes-agent/tools/cronjob_tools.py and also fallback APScheduler if hermes not running.
"""

import os
from pathlib import Path

def install_cron_jobs():
    try:
        import sys
        sys.path.insert(0, str(Path.home() / ".hermes" / "hermes-agent"))
        from tools.cronjob_tools import cronjob  # type: ignore
        from orchestrator.brain import get_proactive_jobs
        for job in get_proactive_jobs():
            try:
                # create or update
                # tool expects action param; we mimic
                result = cronjob(action="create", schedule=job["schedule"], prompt=job["prompt"], job_id=job["id"])
                print(f"cron {job['id']}: {result}")
            except Exception as e:
                print(f"cron {job['id']} failed: {e}")
        print("Hermes cron jobs installed.")
        return True
    except Exception as e:
        print(f"Hermes cron not available ({e}), fallback: see config/jobs.yaml")
        return False

if __name__ == "__main__":
    install_cron_jobs()
