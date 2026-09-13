import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('voice overlay and hotkeys', () => {
  it('ships a non-focus-stealing overlay entry and Right Option gate', () => {
    const overlay = readFileSync(join(import.meta.dir, '../../../voice-overlay.tsx'), 'utf8')
    expect(overlay).toContain('voice.overlay.recording')
    expect(overlay).toContain('stopVoiceCapture')
    const main = readFileSync(join(import.meta.dir, '../../../../main/voice/overlay-window.ts'), 'utf8')
    expect(main).toContain('showInactive')
    expect(main).toContain('focusable: false')
    expect(main).toContain('canBindAccelerator')
  })
})
