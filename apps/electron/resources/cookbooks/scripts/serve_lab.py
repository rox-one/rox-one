#!/usr/bin/env python3
"""Start the loopback Cookbooks Lab (HTML + JSON) on 127.0.0.1."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from rox_cookbooks.host import LabHost


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", default=str(Path.cwd() / ".rox-cookbooks-workspace"))
    parser.add_argument("--store", default=None)
    args = parser.parse_args()
    lab = LabHost(
        Path(args.workspace),
        store_path=Path(args.store) if args.store else None,
    )
    url = lab.start()
    print(f"{url}/lab.html?token={lab.token}")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        lab.stop()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
