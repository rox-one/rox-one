import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceHost, getDefaultVoicePrefs } from '..'

test('overlay phases and elapsed capture time come from real host transitions, with no synthetic transcript or RMS', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-overlay-host-'))
  let now = 1000
  let finish: (value: any) => void = () => {}
  const host = new VoiceHost(directory, { transcribe: () => new Promise(resolve => { finish = resolve }) }, () => now)
  const phases: string[] = []
  let last: ReturnType<VoiceHost['overlay']> | undefined
  host.on(event => { phases.push(event.overlay.phase); last = event.overlay })
  const prefs = getDefaultVoicePrefs(now)
  try {
    host.start(prefs); expect(host.overlay().phase).toBe('permission')
    host.grantPermission(); now = 2345
    host.chunk(new Uint8Array([1, 2, 3])); expect(host.overlay()).toMatchObject({ phase: 'recording', elapsedMs: 1345, rms: 0, streaming: false })
    const pending = host.stop(prefs)
    expect(host.overlay().phase).toBe('transcribing')
    now = 5000
    finish({ text: 'actual fixture result', segments: [], requestedModelId: 'fixture', resolvedModelId: 'fixture', durationMs: 1345 })
    await pending
    expect(last).toMatchObject({ phase: 'ready', elapsedMs: 1345 })
    expect(host.overlay().phase).toBe('hidden')
    expect(phases).toEqual(['permission', 'recording', 'recording', 'transcribing', 'ready'])
    host.cancel(); expect(host.overlay().phase).toBe('hidden')
  } finally { host.cancel(); rmSync(directory, { recursive: true, force: true }) }
})
