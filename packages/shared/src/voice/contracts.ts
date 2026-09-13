/**
 * Public ROX voice gateway contract.
 *
 * `rocks-t1` is the desktop model id for the free ROX transcription route.
 * It is not a claim that the alias is already deployed; the gateway client
 * must confirm via capabilities or a live transcription.
 */

export const ROX_VOICE_GATEWAY_BASE_URL = 'https://api.rox.one/v1'
export const ROX_VOICE_PUBLIC_MODEL_ID = 'rocks-t1'
export const ROX_VOICE_UI_NAME = 'rocks transcription (rocks t1)'
export const ROX_VOICE_PUBLIC_CLIENT_ID = 'rox-desktop-voice'
export const ROX_VOICE_UPSTREAM_ASR_MODEL = 'whisper-large-v3-turbo'
export const ROX_VOICE_PROCESS_MODEL = 'gpt-5.3-spark'
export const ROX_VOICE_PROCESS_FALLBACK = 'groq/compound'
export const ROX_VOICE_LANGUAGE_LABEL = 'Multilingual · auto-detect · timestamps'
export const ROX_VOICE_BOOTSTRAP_PATH = '/voice/bootstrap'
export const ROX_VOICE_CAPABILITIES_PATH = '/voice/capabilities'
export const ROX_VOICE_TRANSCRIPTIONS_PATH = '/audio/transcriptions'
export const ROX_VOICE_PROCESS_PATH = '/voice/process'
export const ROX_VOICE_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000

export const ROX_VOICE_ALLOWED_SCOPES = [
  'voice.transcribe',
  'voice.process',
  'voice.capabilities',
] as const

export type RoxVoiceScope = (typeof ROX_VOICE_ALLOWED_SCOPES)[number]
export type VoiceTimestampGranularity = 'segment' | 'word'
export type VoiceAvailability = 'ready' | 'degraded' | 'unavailable'

export interface VoiceTranscriptSegment {
  id: number
  start: number
  end: number
  text: string
}

export interface VoiceTranscriptWord {
  word: string
  start: number
  end: number
}

export interface VoiceCapabilities {
  catalogVersion: string
  routeVersion: string
  modelId: string
  displayName: string
  languages: string[]
  autoDetect: boolean
  timestampGranularities: VoiceTimestampGranularity[]
  streaming: boolean
  allowedMime: string[]
  maxBytes: number
  maxDurationSeconds: number
  availability: VoiceAvailability
  quotaRemaining?: number
  quotaResetAt?: number
}

export interface VoiceBootstrapRequest {
  clientId: string
  installationId: string
  platform: string
  appVersion: string
}

export interface VoiceBootstrapResponse {
  accessToken: string
  expiresAt: number
  refreshToken?: string
  scopes: string[]
  installationId: string
}

export const LAST_KNOWN_GOOD_VOICE_CAPABILITIES: VoiceCapabilities = {
  catalogVersion: 'voice-capabilities-v0',
  routeVersion: 'unverified',
  modelId: ROX_VOICE_PUBLIC_MODEL_ID,
  displayName: ROX_VOICE_UI_NAME,
  languages: [],
  autoDetect: true,
  timestampGranularities: ['segment', 'word'],
  streaming: false,
  allowedMime: [
    'audio/webm',
    'audio/wav',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
  ],
  maxBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 25 * 60,
  availability: 'degraded',
}

const GRANULARITIES: readonly string[] = ['segment', 'word']

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string' && item.trim())) return null
  return value.map((item) => String(item))
}

function asGranularities(value: unknown): VoiceTimestampGranularity[] | null {
  const items = asStringArray(value)
  if (!items || items.length === 0) return null
  if (!items.every((item) => GRANULARITIES.includes(item))) return null
  return items as VoiceTimestampGranularity[]
}

function asAvailability(value: unknown): VoiceAvailability | null {
  if (value === 'ready' || value === 'degraded' || value === 'unavailable') return value
  return null
}

export function parseVoiceCapabilities(
  raw: unknown,
  fallback: VoiceCapabilities = LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
): VoiceCapabilities {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback, availability: 'unavailable' }
  }
  const obj = raw as Record<string, unknown>
  const languages = asStringArray(obj.languages)
  const allowedMime = asStringArray(obj.allowedMime)
  const timestampGranularities = asGranularities(obj.timestampGranularities)
  const availability = asAvailability(obj.availability)
  const maxBytes = typeof obj.maxBytes === 'number' && obj.maxBytes > 0 ? obj.maxBytes : null
  const maxDurationSeconds =
    typeof obj.maxDurationSeconds === 'number' && obj.maxDurationSeconds > 0
      ? obj.maxDurationSeconds
      : null
  const displayName = typeof obj.displayName === 'string' ? obj.displayName : null
  if (
    typeof obj.catalogVersion !== 'string' ||
    typeof obj.routeVersion !== 'string' ||
    typeof obj.modelId !== 'string' ||
    displayName === null ||
    languages === null ||
    allowedMime === null ||
    timestampGranularities === null ||
    availability === null ||
    maxBytes === null ||
    maxDurationSeconds === null ||
    typeof obj.autoDetect !== 'boolean' ||
    typeof obj.streaming !== 'boolean'
  ) {
    const availabilityNext = fallback.availability === 'ready' ? 'degraded' : fallback.availability
    return { ...fallback, availability: availabilityNext }
  }
  return {
    catalogVersion: obj.catalogVersion,
    routeVersion: obj.routeVersion,
    modelId: obj.modelId,
    displayName,
    languages,
    autoDetect: obj.autoDetect,
    timestampGranularities,
    streaming: obj.streaming,
    allowedMime,
    maxBytes,
    maxDurationSeconds,
    availability,
    quotaRemaining: typeof obj.quotaRemaining === 'number' ? obj.quotaRemaining : undefined,
    quotaResetAt: typeof obj.quotaResetAt === 'number' ? obj.quotaResetAt : undefined,
  }
}

export function voiceLanguageLabel(capabilities: VoiceCapabilities): string {
  if (capabilities.languages.length === 74) {
    return '74 languages · auto-detect · timestamps'
  }
  if (capabilities.languages.length > 0) {
    return `${capabilities.languages.length} languages · auto-detect · timestamps`
  }
  return ROX_VOICE_LANGUAGE_LABEL
}

export function scopesAreVoiceOnly(scopes: string[]): boolean {
  return scopes.length > 0 && scopes.every((scope) =>
    (ROX_VOICE_ALLOWED_SCOPES as readonly string[]).includes(scope),
  )
}
