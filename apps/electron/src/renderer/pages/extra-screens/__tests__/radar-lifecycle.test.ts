import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('radar lifecycle in an isolated native-window fixture', async () => {
  const child = Bun.spawn([process.execPath, 'test', resolve(import.meta.dir, 'radar-lifecycle.fixture.ts')], {
    cwd: resolve(import.meta.dir, '../../../../..'), stdout: 'pipe', stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code, stdout + stderr).toBe(0)
}, 30_000)
