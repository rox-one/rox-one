import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('InputSettingsPage voice section', () => {
  it('renders the shared voice settings through i18n', () => {
    const source = readFileSync(
      join(import.meta.dir, '../InputSettingsPage.tsx'),
      'utf8',
    )
    expect(source).toContain('VoiceSettingsSection')
  })

  it('wires overlay, microphone, history playback and archive actions', () => {
    const section = readFileSync(
      join(import.meta.dir, '../VoiceSettingsSection.tsx'),
      'utf8',
    )
    expect(section).toContain('voiceOverlay')
    expect(section).toContain('voiceDevice')
    expect(section).toContain('getVoiceRecordingAudio')
    expect(section).toContain('favoriteVoiceRecording')
    expect(section).toContain('deleteVoiceRecording')
    expect(section).toContain('getVoiceArchiveDir')
    expect(section).toContain('retranscribeVoiceRecording')
    expect(section).toContain('exportVoiceRecording')
    expect(section).toContain('selectVoiceRevision')
    expect(section).toContain('editVoiceTranscript')
    expect(section).toContain('audioAvailable')
    expect(section).toContain('voiceLanguage')
    expect(section).toContain('voiceOverlayPosition')
    expect(section).toContain('voiceTrailingSpace')
    expect(section).toContain('audioRetentionSessionDesc')
    expect(section).toContain('voiceHistoryDesc')
  })
})
