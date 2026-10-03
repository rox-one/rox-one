import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('enrolled native Feed uses actor/workspace custody, pure reads, guarded mutations and scoped events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-feed-rpc-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/native-feed.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: directory, ROX_CONFIG_DIR: directory }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const checks: Array<{ name: string; passed: boolean }> = JSON.parse(stdout)
    expect(checks.length).toBeGreaterThanOrEqual(35)
    expect(checks.filter(check => !check.passed)).toEqual([])
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 20000)
