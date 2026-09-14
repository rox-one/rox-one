/**
 * I030 eval runner is a later card. I029 only creates the entrypoint
 * so `bun run test:meetings:eval` is not a missing-script failure.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const thresholds = JSON.parse(readFileSync(join(here, 'thresholds.json'), 'utf8')) as {
  schemaVersion: number
  status: string
}
if (thresholds.status !== 'not_run') {
  throw new Error('I029 eval entrypoint must stay not_run until I030 lands')
}
console.log(JSON.stringify({ result: 'not_run', level: 'E30', thresholds }))
