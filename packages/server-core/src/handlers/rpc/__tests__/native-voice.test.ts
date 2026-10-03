import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('authenticated native voice uses private actor preferences/history and aborts stale audio work over real WS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rox-native-voice-'))
  try {
    const process_ = Bun.spawn([process.execPath, join(import.meta.dir, 'native-voice.fixture.ts')], {
      cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([process_.exited, new Response(process_.stdout).text(), new Response(process_.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0,
      stdout: 'native voice isolation, real streamed ASR, consent, persistence, cancellation and revocation passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20_000)
