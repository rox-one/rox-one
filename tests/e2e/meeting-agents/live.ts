/**
 * I029 live runner. Does not call live api.rox.one from this slice.
 * L4 remains not_run until a permitted live route is attached.
 */

import { evidenceRow, writeEvidence } from './harness.ts'

const path = writeEvidence(evidenceRow('L4', 'not_run', {
  caseId: 'E29-live',
  command: 'bun run test:meetings:live',
  blocker: 'Live api.rox.one / provider credentials are out of scope for this I029 slice',
}))
console.log(JSON.stringify({ path, result: 'not_run', level: 'L4' }))
