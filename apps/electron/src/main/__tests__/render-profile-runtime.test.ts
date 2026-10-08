import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Isolate Electron mocks and platform overrides from other Bun suites.
test('PERF-07: main resolves the low-power profile and ships it in the shell snapshot', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dir, 'render-profile.fixture.ts')], {
    encoding: 'utf8', timeout: 15_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({ passed: true, scenarios: 5 })
})
