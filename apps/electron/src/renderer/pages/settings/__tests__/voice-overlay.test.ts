import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('voice overlay and hotkeys', () => {
  it('ships a non-focus-stealing overlay entry and Right Option gate', () => {
    const overlay = readFileSync(join(import.meta.dir, '../../../voice-overlay.tsx'), 'utf8')
    expect(overlay).toContain('voice.overlay.recording')
    // The overlay renderer never drives the capture pipeline directly. It speaks only
    // through the dedicated child-window bridge exposed by preload/voice-overlay.ts.
    expect(overlay).toContain('window.voiceOverlay?.onState')
    expect(overlay).toContain('window.voiceOverlay?.[action]')
    expect(overlay).not.toContain('stopVoiceCapture')
    const bridge = readFileSync(join(import.meta.dir, '../../../../preload/voice-overlay.ts'), 'utf8')
    expect(bridge).toContain("exposeInMainWorld('voiceOverlay'")
    expect(bridge).toContain('rox:owned-voice-overlay:command')
    const owner = readFileSync(join(import.meta.dir, '../../../../main/voice/overlay-owner.ts'), 'utf8')
    expect(owner).toContain('showInactive')
    expect(owner).toContain('focusable: false')
    const hotkeys = readFileSync(join(import.meta.dir, '../../../../main/voice/overlay-window.ts'), 'utf8')
    expect(hotkeys).toContain('canBindAccelerator')
  })
})