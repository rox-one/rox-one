import { ROCKS_T1_DISPLAY_NAME, ROCKS_T1_MODEL_ID, ROCKS_T1_ROUTE } from './contracts.ts'

export type VoiceAvailability = 'ok' | 'degraded' | 'unavailable'

export interface VoiceLanguage { code: string; name: string }
export interface VoiceQuota { remaining: number; resetAt: number }

export interface VoiceCapabilities {
  catalogVersion: string
  routeVersion: string
  modelId: string
  displayName: string
  languages: VoiceLanguage[]
  autoDetect: boolean
  timestampGranularities: Array<'segment' | 'word'>
  streaming: boolean
  allowedMime: string[]
  maxBytes: number
  maxDurationSeconds: number
  quota: { asr: VoiceQuota; process: VoiceQuota }
  availability: VoiceAvailability
  killSwitch: boolean
  signatureValid: boolean
}

export const LAST_KNOWN_GOOD_CAPABILITIES: VoiceCapabilities = {
  catalogVersion: 'lkg',
  routeVersion: 'lkg',
  modelId: ROCKS_T1_MODEL_ID,
  displayName: ROCKS_T1_DISPLAY_NAME,
  languages: [
    { code: 'en', name: 'English' },
    { code: 'ru', name: 'Russian' },
  ],
  autoDetect: true,
  timestampGranularities: ['segment'],
  streaming: false,
  allowedMime: ['audio/wav', 'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4'],
  maxBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 1800,
  quota: {
    asr: { remaining: 0, resetAt: 0 },
    process: { remaining: 0, resetAt: 0 },
  },
  availability: 'unavailable',
  killSwitch: false,
  signatureValid: false,
}

export function languageBadgeCount(caps: Pick<VoiceCapabilities, 'languages'>): number | null {
  return caps.languages.length > 0 ? caps.languages.length : null
}

export function shouldShow74LanguageBadge(caps: Pick<VoiceCapabilities, 'languages'>): boolean {
  return caps.languages.length === 74
}

export function parseCapabilities(raw: unknown, previous: VoiceCapabilities = LAST_KNOWN_GOOD_CAPABILITIES): VoiceCapabilities {
  if (!raw || typeof raw !== 'object') return { ...previous, signatureValid: false, availability: 'unavailable' }
  const obj = raw as Record<string, unknown>
  if (obj.signatureValid === false || obj.schemaOk === false) {
    return { ...previous, signatureValid: false, availability: previous.availability === 'ok' ? 'degraded' : 'unavailable' }
  }
  const languages = Array.isArray(obj.languages)
    ? obj.languages.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const lang = item as Record<string, unknown>
      if (typeof lang.code !== 'string') return []
      return [{ code: lang.code, name: typeof lang.name === 'string' ? lang.name : lang.code }]
    })
    : previous.languages
  return {
    catalogVersion: typeof obj.catalogVersion === 'string' ? obj.catalogVersion : previous.catalogVersion,
    routeVersion: typeof obj.routeVersion === 'string' ? obj.routeVersion : previous.routeVersion,
    modelId: typeof obj.modelId === 'string' ? obj.modelId : ROCKS_T1_MODEL_ID,
    displayName: typeof obj.displayName === 'string' ? obj.displayName : ROCKS_T1_DISPLAY_NAME,
    languages,
    autoDetect: obj.autoDetect !== false,
    timestampGranularities: Array.isArray(obj.timestampGranularities)
      ? obj.timestampGranularities.filter((item): item is 'segment' | 'word' => item === 'segment' || item === 'word')
      : ['segment'],
    streaming: obj.streaming === true,
    allowedMime: Array.isArray(obj.allowedMime) ? obj.allowedMime.filter((item): item is string => typeof item === 'string') : previous.allowedMime,
    maxBytes: typeof obj.maxBytes === 'number' ? obj.maxBytes : previous.maxBytes,
    maxDurationSeconds: typeof obj.maxDurationSeconds === 'number' ? obj.maxDurationSeconds : previous.maxDurationSeconds,
    quota: {
      asr: parseQuota(obj.quota, 'asr', previous.quota.asr),
      process: parseQuota(obj.quota, 'process', previous.quota.process),
    },
    availability: obj.availability === 'ok' || obj.availability === 'degraded' || obj.availability === 'unavailable'
      ? obj.availability
      : previous.availability,
    killSwitch: obj.killSwitch === true,
    signatureValid: obj.signatureValid !== false,
  }
}

function parseQuota(raw: unknown, key: 'asr' | 'process', fallback: VoiceQuota): VoiceQuota {
  if (!raw || typeof raw !== 'object') return fallback
  const quota = (raw as Record<string, unknown>)[key]
  if (!quota || typeof quota !== 'object') return fallback
  const obj = quota as Record<string, unknown>
  return {
    remaining: typeof obj.remaining === 'number' ? obj.remaining : fallback.remaining,
    resetAt: typeof obj.resetAt === 'number' ? obj.resetAt : fallback.resetAt,
  }
}

export function rocksT1RouteNote(): { alias: string; route: string; upstream: string; brand: string } {
  return {
    alias: ROCKS_T1_MODEL_ID,
    route: ROCKS_T1_ROUTE,
    upstream: 'whisper-large-v3-turbo',
    brand: ROCKS_T1_DISPLAY_NAME,
  }
}
