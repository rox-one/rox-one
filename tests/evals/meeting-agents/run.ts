#!/usr/bin/env bun
/**
 * RMA-I030 eval runner. Targets are not current scores.
 * Missing tests fail closed (no silent skip).
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const unitGlobs = [
  'packages/server-core/src/meetings/__tests__/budgets.test.ts',
  'packages/server-core/src/meetings/__tests__/release-gate.test.ts',
]

for (const rel of unitGlobs) {
  const path = join(process.cwd(), rel)
  if (!existsSync(path)) {
    console.error(`missing eval dependency: ${rel}`)
    process.exit(1)
  }
}

console.log(JSON.stringify({
  kind: 'eval',
  live: false,
  holdout: 'not_run',
  targetsOnly: true,
  thresholds: 'tests/evals/meeting-agents/thresholds.json',
}))
