import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('actual generated task, automation test and scheduler launch provenance remain private and measured', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-runtime-launch-producers-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/runtime-launch-producers.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    expect(stdout).toContain('runtime launch producer fixtures passed')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 15000)
