import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const scenario of ['owned', 'restart', 'forged', 'revoked', 'root', 'held-pair', 'status-revoked', 'repair-failed', 'diagnostics', 'dismiss', 'disabled', 'recovery', 'recovery-foreign', 'recovery-bad-code', 'recovery-disabled']) {
  test(`native messaging producer ${scenario}: actual registry, gateway and scoped WebSocket`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rox-native-messaging-producer-'))
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-messaging-producer.ts'), scenario], {
        cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: directory, CRAFT_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: `native messaging producer ${scenario} passed\n`, stderr: '' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }, 20000)
}
