import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
/** Isolated globals: the actual renderer singleton and native disk store never leak into aggregate fixtures. */
test('confirmed task import uses native CAS, readback and current-owner controls', async () => {
  const child = Bun.spawn([process.execPath, 'test', resolve(import.meta.dirname, 'personal-tasks-import.fixture.ts')], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ exit, output: stdout + stderr }).toMatchObject({ exit: 0 })
  expect(stdout + stderr).toContain('10 pass')
}, 30_000)
