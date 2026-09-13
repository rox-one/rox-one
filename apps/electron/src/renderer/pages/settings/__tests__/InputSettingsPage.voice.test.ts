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
    const section = readFileSync(join(import.meta.dir, '../VoiceSettingsSection.tsx'), 'utf8')
    expect(section).toContain('settings.input.voiceGroupGeneral')
    expect(section).toContain('settings.input.voiceGroupHistory')
    expect(section).toContain('settings.input.voiceGroupModels')
    expect(section).toContain('settings.input.voiceGroupProcessing')
    expect(section).toContain('voiceAsrConsent')
    expect(section).toContain('voiceEnhancementConsent')
    expect(section).toContain('voiceWebEnrichment')

  })
})
