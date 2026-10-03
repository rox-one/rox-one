import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('actual native Tasks custody is isolated, read-only, durable, revision-safe and authority-fenced', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-personal-tasks-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-personal-tasks.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: directory, ROX_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const proof = JSON.parse(stdout)
    expect(proof.passed).toBe(true)
    expect(proof.checks).toBeGreaterThanOrEqual(25)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 15000)
