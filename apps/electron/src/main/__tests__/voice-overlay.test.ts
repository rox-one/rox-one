import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseVoiceOverlayState } from '../../shared/voice-overlay-ipc'
import { rmsFromTimeDomain } from '../../renderer/voice/capture-session'

describe('voice overlay and capture wiring', () => {
  it('uses a non-activating panel and an isolated overlay preload', () => {
    const overlay = readFileSync(join(import.meta.dir, '../voice-overlay.ts'), 'utf8')
    expect(overlay).toContain('showInactive')
    expect(overlay).toContain('focusable: false')
    expect(overlay).toContain('skipTaskbar: true')
    expect(overlay).toContain('voice-overlay-preload.cjs')
    expect(overlay).not.toContain('bootstrap-preload.cjs')
    expect(overlay).toContain('overlayPosition')
    expect(overlay).toContain("position === 'bottom'")
  })

  it('does not expose the full ElectronAPI from the overlay preload', () => {
    const preload = readFileSync(join(import.meta.dir, '../../preload/voice-overlay.ts'), 'utf8')
    expect(preload).toContain("exposeInMainWorld('voiceOverlay'")
    expect(preload).not.toContain('CHANNEL_MAP')
    expect(preload).not.toContain('saveVoicePrefs')
    expect(preload).not.toContain('getVoicePrefs')
  })

  it('shows a live meter and separate stop/cancel actions', () => {
    const ui = readFileSync(join(import.meta.dir, '../../renderer/voice-overlay.tsx'), 'utf8')
    expect(ui).toContain("dispatch('toggle')")
    expect(ui).toContain("dispatch('cancel')")
    expect(ui).toContain('state.rms')
    expect(ui).toContain('chat.dictateTranscribing')
    expect(ui).not.toContain('result?.text')
  })

  it('parses overlay meter state without inventing a live transcript', () => {
    expect(parseVoiceOverlayState({ visible: true, recording: true, rms: 1.5, elapsedMs: 1200 })).toEqual({
      visible: true,
      recording: true,
      busy: false,
      rms: 1,
      elapsedMs: 1200,
    })
  })

  it('computes RMS from captured samples rather than a looping animation', () => {
    const silent = new Uint8Array(8).fill(128)
    const loud = new Uint8Array([128, 255, 0, 128, 255, 0, 128, 200])
    expect(rmsFromTimeDomain(silent)).toBe(0)
    expect(rmsFromTimeDomain(loud)).toBeGreaterThan(0.4)
  })

  it('stops overlay, hotkeys and VoiceHost on quit', () => {
    const main = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
    expect(main).toContain('unbindVoiceHotkeys')
    expect(main).toContain('destroyVoiceOverlay')
    expect(main).toContain('shutdownVoiceHandlers')
    const runtime = readFileSync(join(import.meta.dir, '../../renderer/voice/VoiceRuntime.tsx'), 'utf8')
    expect(runtime).toContain("addEventListener('pagehide'")
    expect(runtime).toContain("addEventListener('beforeunload'")
    expect(runtime).toContain('voiceCaptureSession.cancel')
  })
})
