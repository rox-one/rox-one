#!/usr/bin/env bun
/**
 * Live L4 meeting-agents path (TESTS §2). Fail-closed unless the owner-granted
 * sandbox flag is set. A missing flag is blocked, not a green skip.
 * Aligned with test:meetings:live — do not report success without a live stand.
 */

if (process.env.ROX_MEETING_LIVE !== '1') {
  console.error(
    JSON.stringify({
      caseId: 'L4-live',
      result: 'blocked',
      level: 'L4',
      blocker: 'ROX_MEETING_LIVE unset; live Mail/CRM/Calendar/GitHub/Linear remain blocked (owner #333)',
    }),
  )
  process.exit(1)
}

console.error(
  JSON.stringify({
    caseId: 'L4-live',
    result: 'blocked',
    level: 'L4',
    blocker: 'live runner is not wired to a sandbox in this I029 slice',
  }),
)
process.exit(1)
