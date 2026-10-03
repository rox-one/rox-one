import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real authenticated WS composes the current local overlay owner and retires a revoked capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-overlay-ws-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'voice-overlay-ws.fixture.ts')], {
      env: { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stderr: '', stdout: 'authenticated overlay owner, actual capture phases, original local window binding and revoke retirement passed\n' })
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 60_000)
