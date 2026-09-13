#!/usr/bin/env python3
"""disk_cleanup.py — reclaim disk space on a fleet host.

Windmill schedule: daily at 03:00 (worker group: linux-small).
Rollback: disable the schedule.

Usage:
  python3 disk_cleanup.py [--apply] [--warn-percent N] [--clean-percent N]

Behavior (thresholds default warn=85 / clean=92 percent used):
  - always: report current usage; journalctl vacuum to 200M; apt-get clean.
  - >= clean threshold (or --apply): additionally `docker system prune -f
    --volumes=false`.
  Dry-run is the DEFAULT: destructive docker prune only runs with --apply or
  when usage is at/above the clean threshold. Every subprocess failure raises.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys


def run(cmd: list[str], dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] would run: {' '.join(cmd)}")
        return
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        raise SystemExit(
            f"disk_cleanup: command failed ({' '.join(cmd)}), exit {result.returncode}: {result.stderr.strip()}"
        )
    out = result.stdout.strip()
    if out:
        print(out)


def root_usage_percent() -> int:
    total, _, free = shutil.disk_usage("/")
    return int((total - free) / total * 100)


def main() -> None:
    ap = argparse.ArgumentParser(description="Fleet disk cleanup")
    ap.add_argument("--apply", action="store_true", help="allow destructive cleanup regardless of threshold")
    ap.add_argument("--warn-percent", type=int, default=85)
    ap.add_argument("--clean-percent", type=int, default=92)
    args = ap.parse_args()

    if not (0 < args.warn_percent < args.clean_percent <= 100):
        raise SystemExit("disk_cleanup: require 0 < warn-percent < clean-percent <= 100")

    used = root_usage_percent()
    print(f"disk_cleanup: / usage {used}%")
    if used >= args.clean_percent:
        level = "clean"
    elif used >= args.warn_percent:
        level = "warn"
    else:
        print("disk_cleanup: below warn threshold; nothing to do")
        return
    print(f"disk_cleanup: at {level} threshold ({used}%)")

    # Safe maintenance steps — always executed when a threshold trips.
    run(["journalctl", "--vacuum-size=200M"], dry_run=False)
    run(["apt-get", "clean"], dry_run=False)

    # Destructive step — only with --apply or at/above clean threshold.
    if args.apply or level == "clean":
        run(["docker", "system", "prune", "-f", "--volumes=false"], dry_run=False)
    else:
        print("[dry-run] would run: docker system prune -f --volumes=false (needs --apply or clean threshold)")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        raise SystemExit(f"disk_cleanup: required binary missing: {e}")
    except KeyboardInterrupt:
        sys.exit(130)
