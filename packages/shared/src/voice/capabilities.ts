import {
  LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
  parseVoiceCapabilities,
  type VoiceCapabilities,
} from './contracts.ts'

let cached: VoiceCapabilities = { ...LAST_KNOWN_GOOD_VOICE_CAPABILITIES }

export function getCachedVoiceCapabilities(): VoiceCapabilities {
  return cached
}

export function rememberVoiceCapabilities(raw: unknown): VoiceCapabilities {
  const parsed = parseVoiceCapabilities(raw, cached)
  cached = parsed
  return parsed
}

export function resetVoiceCapabilitiesCache(
  value: VoiceCapabilities = LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
): void {
  cached = { ...value }
}
