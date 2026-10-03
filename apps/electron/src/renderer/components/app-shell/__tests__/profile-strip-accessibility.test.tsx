import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Renderer tests mock react-i18next at module scope. Verify the real translated
// account descriptions in a fresh process so test order cannot replace them.
test('ProfileStrip preserves its translated accessibility contracts in isolation', () => {
  const appRoot = join(import.meta.dir, '../../../../..')
  const result = spawnSync(process.execPath, [
    'test', './src/renderer/components/app-shell/__tests__/profile-strip-accessibility.isolated.tsx',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 15_000 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  expect(result.error, output).toBeUndefined()
  expect(result.status, output).toBe(0)
  expect(output).toContain('5 pass')
  expect(output).toContain('0 fail')
}, 20_000)
