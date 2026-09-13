import { describe, expect, it, afterEach } from 'bun:test'
import {
  LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
  parseVoiceCapabilities,
  resetVoiceCapabilitiesCache,
  rememberVoiceCapabilities,
  voiceLanguageLabel,
} from '../index.ts'

describe('voice capabilities contract', () => {
  afterEach(() => {
    resetVoiceCapabilitiesCache()
  })
  it('falls back to last-known-good when the payload is incomplete', () => {
    const parsed = parseVoiceCapabilities({ modelId: 'rocks-t1' })
    expect(parsed.modelId).toBe(LAST_KNOWN_GOOD_VOICE_CAPABILITIES.modelId)
    expect(parsed.availability).not.toBe('ready')
  })

  it('uses the 74-language label only for an exact catalog', () => {
    const languages = Array.from({ length: 74 }, (_, i) => `l${i}`)
    const caps = parseVoiceCapabilities({
      ...LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
      languages,
      availability: 'ready',
    })
    expect(voiceLanguageLabel(caps)).toBe('74 languages · auto-detect · timestamps')
    expect(voiceLanguageLabel({ ...caps, languages: languages.slice(0, 73) })).toBe('73 languages · auto-detect · timestamps')
    expect(voiceLanguageLabel({ ...caps, languages: [] })).toBe('Multilingual · auto-detect · timestamps')
  })

  it('remembers the last valid snapshot', () => {
    resetVoiceCapabilitiesCache()
    const remembered = rememberVoiceCapabilities({
      ...LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
      catalogVersion: 'v1',
      routeVersion: 'r1',
      availability: 'ready',
    })
    expect(remembered.availability).toBe('ready')
    const degraded = rememberVoiceCapabilities({ modelId: 'nope' })
    expect(degraded.availability).toBe('degraded')
    expect(degraded.catalogVersion).toBe('v1')
  })
})
