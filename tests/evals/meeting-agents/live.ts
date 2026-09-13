#!/usr/bin/env bun
/**
 * Live L4 meeting-agents path. Fail-closed unless the owner-granted
 * sandbox flag is set. A missing flag is blocked, not a green skip.
 */

if (process.env.ROX_MEETING_LIVE !== '1') {
  console.error('ROX_MEETING_LIVE is unset; live Mail/CRM/Calendar/GitHub/Linear remain blocked')
  process.exit(1)
}

console.error('live runner is not wired to a sandbox in this slice')
process.exit(1)
