import { expect, test } from 'bun:test'
import { captureTestCommand } from '../../../../../../scripts/test-all'
import { join } from 'node:path'

test('recovered renderer contracts mount with real component implementations', async () => {
  const appRoot = join(import.meta.dir, '../../../..')
  const captured = await captureTestCommand([process.execPath,
    '--preload', '../../scripts/test-config-isolation.ts',
    '--preload', '../../packages/shared/src/test-preload-pdfjs-url.ts',
    '--preload', '../../scripts/test-vite-url-shim.ts',
    './src/renderer/components/__tests__/renderer-contract-recovery.isolated.tsx',
  ], { cwd: appRoot, timeoutMs: 15_000 })
  const result = {
    status: captured.exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    error: captured.timedOut ? new Error('Renderer contract child exceeded its 15000ms deadline') : undefined,
  }
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('RENDERER_CONTRACT_RECOVERY_OK')
}, 20_000)
