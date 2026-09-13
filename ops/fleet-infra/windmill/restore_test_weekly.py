#!/usr/bin/env python3
"""restore_test_weekly.py — weekly restore drill for the fleet backup.

Windmill schedule: weekly Sunday 04:00 (worker group: backup).
Rollback: disable the schedule.

Usage:
  python3 restore_test_weekly.py [--marker .restore-marker] [--keep-manifest PATH]

Behavior:
  1. `restic restore latest --target <tempdir>` (RESTIC_* env required,
     injected by the Infisical identity).
  2. Verify the marker file exists inside the restored tree; fail loudly if not.
  3. Remove the tempdir.
  4. Write a manifest (JSON) recording result, duration, and file count.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

REQUIRED_ENV = ("RESTIC_REPOSITORY", "RESTIC_PASSWORD")


def require_env() -> None:
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            f"restore_test: missing required env vars: {', '.join(missing)} "
            "(Infisical identity must export RESTIC_*)"
        )


def run(cmd: list[str]) -> str:
    print(f"restore_test: running {' '.join(cmd[:2])} ...")
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f"restore_test: {' '.join(cmd[:2])} failed exit {result.returncode}: {result.stderr.strip()}")
    return result.stdout


def main() -> None:
    ap = argparse.ArgumentParser(description="Weekly restic restore verification")
    ap.add_argument("--marker", default=".restore-marker", help="marker path relative to restore root")
    ap.add_argument("--manifest", default="restore-test-manifest.json", help="manifest output path")
    args = ap.parse_args()

    require_env()
    started = time.time()
    tmpdir = tempfile.mkdtemp(prefix="restic-restore-test-")
    status = "passed"
    error = None
    return_values = {}
    try:
        run(["restic", "restore", "latest", "--target", tmpdir])
        marker = os.path.join(tmpdir, args.marker)
        if not os.path.isfile(marker):
            status = "failed"
            raise SystemExit(f"restore_test: marker {args.marker} missing from restored snapshot — backup is incomplete")
        file_count = sum(len(files) for _, _, files in os.walk(tmpdir))
        print(f"restore_test: marker present, {file_count} files verified")
        return_values = {"files": file_count}
    except SystemExit as e:
        if status != "failed":
            status = "failed"
            error = str(e)
        raise
    finally:
        elapsed = round(time.time() - started, 1)
        manifest = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": status,
            "duration_seconds": elapsed,
            **return_values,
            **({"error": error} if error else {}),
        }
        with open(args.manifest, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)
            fh.write("\n")
        shutil.rmtree(tmpdir, ignore_errors=False)
        print(f"restore_test: {status} in {elapsed}s, tempdir cleaned, manifest at {args.manifest}")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        raise SystemExit(f"restore_test: required binary missing: {e}")
    sys.exit(0)
