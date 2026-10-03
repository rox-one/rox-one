import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Isolate Electron mocks and platform overrides from other Bun handler suites.
test('material applies only after paint and follows actual app GPU/accessibility events', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dir, 'zen-shell-material.fixture.ts')], {
    encoding: 'utf8', timeout: 15_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual({ passed: true, scenarios: 8, nativeHardware: false })
})
