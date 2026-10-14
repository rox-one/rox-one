import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Existing renderer tests mock react-i18next at module scope. The sidebar's
// translated disclosure labels and progress must use the real implementation.
test('Tasks sidebar preserves its translated SSR contracts in isolation', () => {
  const appRoot = join(import.meta.dir, '../../../../..')
  const result = spawnSync(process.execPath, [
    'test', './src/renderer/pages/tasks/__tests__/task-sidebar.isolated.tsx',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 15_000 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  expect(result.error, output).toBeUndefined()
  expect(result.status, output).toBe(0)
  expect(output).toContain('7 pass')
  expect(output).toContain('0 fail')
}, 20_000)
