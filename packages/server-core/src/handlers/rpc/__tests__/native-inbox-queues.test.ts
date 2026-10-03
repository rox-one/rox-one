import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const scenario of ['empty', 'owned', 'skills', 'messaging', 'extraction', 'extraction-root', 'lifecycle', 'producer', 'producer-deferred', 'producer-revoked', 'producer-root']) {
  test(`native Inbox ${scenario}: real scoped authority and WebSocket`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rox-native-inbox-'))
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-inbox-queues.ts'), scenario], {
        cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: directory, CRAFT_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: `native Inbox ${scenario} passed\n`, stderr: '' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 20000)
}
