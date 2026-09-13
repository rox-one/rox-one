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
    const control = readFileSync(
      join(import.meta.dir, '../input/VoiceDictationControl.tsx'),
      'utf8',
    )
    expect(control).toContain('voiceCaptureSession')
    expect(control).toContain('joinDraftTranscript')
    expect(control).not.toContain('transcript:')
    expect(control).not.toContain('recorderRef.current?.stop()')
    expect(control).toContain('inputRef.current')
    const app = readFileSync(
      join(import.meta.dir, '../../../App.tsx'),
      'utf8',
    )
    expect(app).toContain('VoiceRuntime')
    const runtime = readFileSync(
      join(import.meta.dir, '../../../voice/VoiceRuntime.tsx'),
      'utf8',
    )
    expect(runtime).toContain('pagehide')
    expect(runtime).toContain('beforeunload')
    expect(runtime).toContain('voiceCaptureSession.cancel')
    const capture = readFileSync(
      join(import.meta.dir, '../../../voice/capture-session.ts'),
      'utf8',
    )
    expect(capture).toContain('applyTranscriptDelivery')
    expect(capture).toContain('navigator.clipboard.writeText')
    const display = readFileSync(
      join(import.meta.dir, '../ChatDisplay.tsx'),
      'utf8',
    )
    expect(display).toContain('onListen')
    expect(display).toContain('speakVoice')
  })
})
