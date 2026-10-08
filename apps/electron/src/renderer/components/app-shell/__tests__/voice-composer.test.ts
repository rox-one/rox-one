import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('voice composer and listen wiring', () => {
  it('exposes dictation in the composer and listen on turns', () => {
    const input = readFileSync(
      join(import.meta.dir, '../input/FreeFormInput.tsx'),
      'utf8',
    )
    expect(input).toContain('VoiceDictationControl')
    const control = readFileSync(join(import.meta.dir, '../input/VoiceDictationControl.tsx'), 'utf8')
    expect(control).toContain('startVoiceCapture')
    expect(control).not.toContain('transcript: draft')
    const display = readFileSync(
      join(import.meta.dir, '../ChatDisplay.tsx'),
      'utf8',
    )
    expect(display).toContain('onListen')
    expect(display).toContain('speakVoice')
  })
})
