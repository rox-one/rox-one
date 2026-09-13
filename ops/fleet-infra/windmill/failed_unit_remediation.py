#!/usr/bin/env python3
"""failed_unit_remediation.py — restart known-safe failed systemd units.

Windmill schedule: every 6 hours alongside inventory refresh
(worker group: linux-small). Rollback: disable the schedule.

Usage:
  python3 failed_unit_remediation.py [--allowlist allowlist.yml]

Behavior:
  - parse `systemctl list-units --failed --no-legend`
  - units present in the allowlist map -> run the mapped action (restart)
  - unknown failed units -> REPORT ONLY, never acted on
  - any subprocess failure raises; nothing is swallowed
"""

from __future__ import annotations

import argparse
import subprocess
import sys

# Fallback allowlist mirrors windmill/settings.example.yml:failed_unit_allowlist.
DEFAULT_ALLOWLIST = {
    "windmill-worker.service": "restart",
    "netbird.service": "restart",
    "tailscaled.service": "restart",
}


def load_allowlist(path: str | None) -> dict[str, str]:
    if path is None:
        return dict(DEFAULT_ALLOWLIST)
    import yaml  # PyYAML; only needed when an explicit file is supplied

    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return {str(k): str(v) for k, v in data.items()}


def list_failed_units() -> list[str]:
    result = subprocess.run(
        ["systemctl", "list-units", "--failed", "--no-legend", "--plain"],
        text=True, capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"failed_remediation: systemctl failed: {result.stderr.strip()}")
    units = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if not parts:
            continue
        unit = parts[0]
        # Skip the trailing "(N loaded units listed)" summary lines.
        if "." in unit:
            units.append(unit)
    return units


def remediate(units: list[str], allowlist: dict[str, str]) -> int:
    exit_code = 0
    for unit in units:
        action = allowlist.get(unit)
        if action is None:
            print(f"REPORT-ONLY {unit}: not in allowlist, no action taken")
            continue
        print(f"remediating {unit}: {action}")
        result = subprocess.run(["systemctl", action, unit], text=True, capture_output=True)
        if result.returncode != 0:
            print(f"FAILED {unit}: systemctl {action} exit {result.returncode}: {result.stderr.strip()}", file=sys.stderr)
            exit_code = 1
        else:
            print(f"OK {unit}: {action} completed")
    return exit_code


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Remediate allowlisted failed systemd units")
    ap.add_argument("--allowlist", help="YAML mapping unit -> action (default built-in)")
    parsed = ap.parse_args()
    raise SystemExit(remediate(list_failed_units(), load_allowlist(parsed.allowlist)))
