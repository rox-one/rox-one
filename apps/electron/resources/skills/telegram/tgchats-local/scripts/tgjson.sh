#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./skills/tgchats-local/scripts/tgjson.sh <tgchats command args...>" >&2
  exit 2
fi

npm run dev -- "$@" --json
