import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const scenario of ['spawn', 'spawn-race', 'spawn-untraced-parent', 'background-nudge', 'system-dispatch', 'legacy']) {
  test(`production trace ${scenario} fixture uses isolated canonical storage`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-trace-contract-'))
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'delegation-compat.fixture.ts'), scenario], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe' })
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
      expect(stdout).toContain(`runtime trace ${scenario} fixture passed`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 15000)
}
