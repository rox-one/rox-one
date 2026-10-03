import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const scenario of ['actors', 'races', 'lifecycle']) {
  test(`actual native WS session sharing ${scenario} with synthetic upstream`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'native-session-sharing-'))
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-session-sharing.ts'), scenario], {
        cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: directory, CRAFT_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: `native sharing ${scenario} passed\n`, stderr: '' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 15000)
}
