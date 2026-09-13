#!/usr/bin/env python3
"""backup_trigger.py — invoke restic backup for the fleet dataset.

Windmill schedule: on demand (worker group: backup), also wired to
restic-backup@.timer on hosts. Rollback: disable the schedule.

Usage:
  python3 backup_trigger.py [paths...]
  python3 backup_trigger.py --check

Requires RESTIC_* environment variables (Infisical identity injects them):
  RESTIC_REPOSITORY, RESTIC_PASSWORD, and optionally
  RESTIC_AWS_ACCESS_KEY_ID / RESTIC_AWS_SECRET_ACCESS_KEY.
Fails loudly when any required variable is unset; no fallbacks.
"""

from __future__ import annotations

import os
import subprocess
import sys

REQUIRED_ENV = ("RESTIC_REPOSITORY", "RESTIC_PASSWORD")
DEFAULT_PATHS = ["/srv", "/etc"]


def require_env() -> None:
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            f"backup_trigger: missing required env vars: {', '.join(missing)} "
            "(Infisical identity must export RESTIC_*)"
        )


def run_restic(args: list[str]) -> None:
    cmd = ["restic", *args]
    print(f"backup_trigger: running {' '.join(cmd)}")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        raise SystemExit(f"backup_trigger: restic {' '.join(args[:1])} failed with exit code {result.returncode}")


def main() -> None:
    require_env()
    args = sys.argv[1:]
    if "--check" in args:
        run_restic(["check"])
        return
    paths = [a for a in args if a != "--check"] or DEFAULT_PATHS
    run_restic(["backup", *paths])


if __name__ == "__main__":
    main()
