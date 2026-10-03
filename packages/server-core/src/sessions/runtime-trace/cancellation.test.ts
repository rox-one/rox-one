import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const scenario of ['transport', 'model']) {
  test(`actual host RPC ${scenario} cancellation preserves unknown process termination`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-trace-cancellation-'))
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'cancellation.fixture.ts'), scenario], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe' })
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
      expect(stdout).toContain(`runtime cancellation ${scenario} fixture passed`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 15000)
}
