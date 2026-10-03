import { describe, expect, it } from 'bun:test'
import { VoiceCommandController } from '../command-controller'
import type { HotkeyCommand } from '@rox/shared/voice/hotkey-types'

function capture(pending = false) {
  let release!: () => void
  const wait = pending ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve()
  let recording = false; let disabled = false; let generation = 0; const actions: string[] = []
  const controller = new VoiceCommandController({ disabled: () => disabled, recording: () => recording,
    async start() { const request = generation; actions.push('start'); await wait; if (request === generation) recording = true },
    stop() { actions.push('stop'); recording = false }, cancel() { actions.push('cancel'); generation++; recording = false } })
  return { controller, actions, release: () => release(), disable: () => { disabled = true }, recording: () => recording }
}

describe('current composer voice command lifecycle', () => {
  it('PTT repeat/unpaired release do not create duplicate captures; release finalizes once', async () => {
    const c = capture(); await c.controller.handle('ptt-up'); await c.controller.handle('ptt-down')
    await c.controller.handle('ptt-down'); await c.controller.handle('ptt-up'); await c.controller.handle('ptt-up')
    expect(c.actions).toEqual(['start', 'stop']); expect(c.recording()).toBe(false)
  })

  it('release during the microphone prompt revokes the request and cannot finalize/upload late audio', async () => {
    const c = capture(true); const starting = c.controller.handle('ptt-down')
    await c.controller.handle('ptt-down'); await c.controller.handle('ptt-up'); c.release(); await starting
    expect(c.actions).toEqual(['start', 'cancel']); expect(c.recording()).toBe(false)
  })

  it('cancel/unmount during pending start retains the request fence, with no late stop', async () => {
    const c = capture(true); const starting = c.controller.handle('toggle')
    await c.controller.handle('cancel'); c.release(); await starting; await c.controller.handle('ptt-up')
    expect(c.actions).toEqual(['start', 'cancel']); expect(c.recording()).toBe(false)
  })

  it('pending toggle cancels without opening a second prompt', async () => {
    const c = capture(true); const starting = c.controller.handle('toggle')
    await c.controller.handle('toggle'); c.release(); await starting
    expect(c.actions).toEqual(['start', 'cancel'])
  })

  it('disabled cannot start; an already-held release and cancel still stop its own capture', async () => {
    const c = capture(); c.disable(); await c.controller.handle('toggle'); await c.controller.handle('ptt-down'); expect(c.actions).toEqual([])
    const active = capture(); await active.controller.handle('ptt-down'); active.disable(); await active.controller.handle('ptt-up')
    expect(active.actions).toEqual(['start', 'stop'])
  })

  it('idle cancel/unknown commands cannot cancel another composer or start a microphone', async () => {
    const c = capture(); await c.controller.handle('cancel'); await c.controller.handle('unknown' as HotkeyCommand)
    expect(c.actions).toEqual([])
  })

  it('active finalization can be cancelled after MediaRecorder stopped; it cannot begin another request', async () => {
    const actions: string[] = []; let active = true
    const c = new VoiceCommandController({ disabled: () => false, recording: () => false, active: () => active,
      async start() { actions.push('start') }, stop() { actions.push('stop') }, cancel() { active = false; actions.push('cancel/delivery-fence') } })
    await c.handle('ptt-down'); expect(actions).toEqual([])
    await c.handle('cancel'); expect(actions).toEqual(['cancel/delivery-fence'])
    await c.handle('cancel'); expect(actions).toHaveLength(1)
  })

  it('normal toggle start/stop and explicit active cancel use existing capture ports', async () => {
    const c = capture(); await c.controller.handle('toggle'); await c.controller.handle('toggle'); await c.controller.handle('toggle'); await c.controller.handle('cancel')
    expect(c.actions).toEqual(['start', 'stop', 'start', 'cancel'])
  })
})
