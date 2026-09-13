/**
 * Voice v2 feature flags. Default ON so the product path ships on main.
 * Tests can override via env. Production local inference still requires
 * installed weights; flags do not fake ASR success.
 */

export type VoiceV2Flag =
  | 'CRAFT_FEATURE_VOICE_CORE_V2'
  | 'CRAFT_FEATURE_VOICE_BACKGROUND_V2'
  | 'CRAFT_FEATURE_VOICE_PROCESSING_V2'
  | 'CRAFT_FEATURE_VOICE_ENRICHMENT_V2'
  | 'CRAFT_FEATURE_VOICE_LOCAL_MODELS_V2'

export const VOICE_V2_FLAGS: readonly VoiceV2Flag[] = [
  'CRAFT_FEATURE_VOICE_CORE_V2',
  'CRAFT_FEATURE_VOICE_BACKGROUND_V2',
  'CRAFT_FEATURE_VOICE_PROCESSING_V2',
  'CRAFT_FEATURE_VOICE_ENRICHMENT_V2',
  'CRAFT_FEATURE_VOICE_LOCAL_MODELS_V2',
] as const

function envFlag(name: VoiceV2Flag): boolean {
  const raw = process.env[name]
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return true
}

export function voiceFlagEnabled(name: VoiceV2Flag): boolean {
  return envFlag(name)
}

export function voiceV2Enabled(): boolean {
  return voiceFlagEnabled('CRAFT_FEATURE_VOICE_CORE_V2')
}
