#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

found=0

check_pattern() {
  local pattern="$1"
  if rg -n --glob '*.ts' --glob '*.tsx' "$pattern" apps/electron/src packages; then
    found=1
  fi
}

check_pattern 'toolName:\s*["'\'']task["'\'']'
check_pattern 'toolName\s*(===|!==)\s*["'\'']Task["'\'']'
check_pattern '["'\'']Task["'\'']\s*(===|!==)\s*toolName'
check_pattern 'toolName\.toLowerCase\(\)\s*(===|!==)\s*["'\'']task["'\'']'

if [ "$found" -ne 0 ]; then
  echo "Legacy task tool-name checks found. Use isParentTaskTool(toolName) or PARENT_TASK_TOOLS instead." >&2
  exit 1
fi
