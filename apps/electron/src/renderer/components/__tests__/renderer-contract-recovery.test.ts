import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

test('recovered renderer contracts mount with real component implementations', () => {
  const appRoot = join(import.meta.dir, '../../../..')
  const result = spawnSync(process.execPath, [
    '--preload', '../../scripts/test-config-isolation.ts',
    '--preload', '../../packages/shared/src/test-preload-pdfjs-url.ts',
    '--preload', '../../scripts/test-vite-url-shim.ts',
    './src/renderer/components/__tests__/renderer-contract-recovery.isolated.tsx',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 15_000 })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('RENDERER_CONTRACT_RECOVERY_OK')
}, 20_000)
