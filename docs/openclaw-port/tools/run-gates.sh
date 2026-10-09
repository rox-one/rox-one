#!/usr/bin/env bash
# Wave-1 gate suite for the OpenClaw -> ROX port.
# Usage: bash docs/openclaw-port/tools/run-gates.sh [--full]
#   default: protocol + i18n + slice-focused tests (fast, ~2 min)
#   --full:  adds `bun run typecheck:all` (~15 min) and the broader package suites
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
fail=0
step() { printf '\n=== %s\n' "$*"; }
run() {
  step "$*"
  if "$@"; then echo "OK: $*"; else echo "FAILED: $*"; fail=1; fi
}

echo "ROX port gate suite — $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# 1. Protocol contract
run bun test packages/shared/src/protocol/__tests__/routing.test.ts
run bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts

# 2. i18n contract
run bun scripts/sort-locales.ts --check
run bun test packages/shared/src/i18n/__tests__/locale-parity.test.ts
run bun run lint:i18n:coverage

# 3. S1 multiuser-core + S2 multiuser-ui
run bun test packages/server-core/src/sessions/__tests__/session-attribution.test.ts
run bun test packages/server-core/src/sessions/__tests__/session-visibility.test.ts
run bun test packages/server-core/src/handlers/rpc/sessions-attribution.test.ts
run bun test apps/electron/src/renderer/lib/__tests__/session-presence.test.ts
run bun test apps/electron/src/renderer/components/app-shell/__tests__/multiuser-ui.test.tsx

# 4. S3 webui-security
run bun test packages/server-core/src/webui/__tests__/csp.test.ts
run bun test packages/server-core/src/webui/__tests__/handoff.test.ts
run bun test packages/server-core/src/webui/__tests__/http-server.test.ts
run bun test packages/server-core/src/transport/__tests__/webui-origin.test.ts

# 5. S4 skills + S5 memory
run bun test packages/shared/src/skills/__tests__/eligibility.test.ts
run bun test packages/shared/src/skills/__tests__/prompt.test.ts
run bun test packages/session-tools-core/src/handlers/skills-tools.test.ts
run bun test packages/session-tools-core/src/handlers/memory-tools.test.ts
run bun test packages/server-core/src/memory/__tests__/memory-index.test.ts
run bun test packages/server-core/src/memory/__tests__/memory-tool-callbacks.test.ts
run bun test packages/server-core/src/memory/__tests__/memory-index-rpc.test.ts

# 6. S6 meetings + S7 lifecycle + S8 voice
run bun test packages/server-core/src/meetings/__tests__
run bun test packages/shared/src/meeting-agents
run bun test packages/server-core/src/service/__tests__
run bun test apps/electron/src/main/__tests__/tray.test.ts
run bun test apps/electron/src/main/__tests__/service-lifecycle-ipc.test.ts
run bun test packages/shared/src/voice/__tests__
run bun test packages/server-core/src/handlers/rpc/__tests__/voice-realtime.test.ts

if [ "$FULL" = "1" ]; then
  run bun run typecheck:all
  run bun test packages/server-core/src/memory
  run bun test packages/core/src/meetings
  # `bun test packages/shared/src/skills` also contains skill-summaries.test.ts and
  # storage.test.ts, whose loadAllSkills cases exceed the 5 s per-test timeout on this
  # machine's ~9.1k-entry skill store — reproduced on pristine origin/main (see
  # STATUS.md § Known pre-existing failures). The port-relevant skills tests run here:
  run bun test packages/shared/src/skills/__tests__/eligibility.test.ts
  run bun test packages/shared/src/skills/__tests__/prompt.test.ts
  run bun test packages/shared/src/skills/__tests__/bundled.test.ts
  run bun test packages/shared/src/collaboration
fi

printf '\n=== RESULT: %s\n' "$([ $fail -eq 0 ] && echo ALL-GREEN || echo FAILURES-PRESENT)"
exit $fail