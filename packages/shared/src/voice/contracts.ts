/** Staging Voice Gateway contract. Public client id is not a secret. */

export const VOICE_GATEWAY_BASE_URL = 'https://api.rox.one/v1'
export const VOICE_PUBLIC_CLIENT_ID = 'rox-desktop-voice'
export const ROCKS_T1_MODEL_ID = 'rocks-t1'
export const ROCKS_T1_DISPLAY_NAME = 'rocks transcription (rocks t1)'
export const ROCKS_T1_UPSTREAM_MODEL = 'whisper-large-v3-turbo'
export const ROCKS_T1_ROUTE = 'rox-ultra'
/** Latest general prerecorded family; version=latest selects its current release. */
export const DEEPGRAM_TRANSCRIPTION_MODEL = 'nova-3'
export const DEEPGRAM_TRANSCRIPTION_NAME = 'Deepgram Nova-3'
/**
 * Opt-in only. The pinned default is Nova-3; the live model catalog may raise it
 * to a newer released Nova family only when the operator sets this to a truthy
 * value. Never upgrade implicitly.
 */
export const DEEPGRAM_MODEL_UPGRADE_ENV = 'DEEPGRAM_ALLOW_MODEL_UPGRADE'

/** The requested Deepgram model: an explicit DEEPGRAM_MODEL override, else the pinned Nova-3. */
export function resolveDeepgramModel(env: Record<string, string | undefined> = {}): string {
  const configured = env.DEEPGRAM_MODEL
  return typeof configured === 'string' && configured.trim() ? configured.trim() : DEEPGRAM_TRANSCRIPTION_MODEL
}

/** True only when the operator explicitly allows a catalog-driven Nova family upgrade. */
export function deepgramModelUpgradeEnabled(env: Record<string, string | undefined> = {}): boolean {
  const value = env[DEEPGRAM_MODEL_UPGRADE_ENV]
  return typeof value === 'string' && /^(?:1|true|yes|on)$/i.test(value.trim())
}

/**
 * Model options for `DeepgramTranscriptionAdapter` on the production path.
 *
 * An explicit `DEEPGRAM_MODEL` pin wins and suppresses catalog upgrades; without
 * one the adapter keeps the pinned Nova-3 default and may raise it from the live
 * catalog only when the operator opted in. Passing the *resolved* default here
 * instead would look like an explicit pin and make the opt-in inert.
 */
export function deepgramTranscriptionOptions(env: Record<string, string | undefined> = {}): { model: string | undefined; allowModelUpgrade: boolean } {
  const configured = env.DEEPGRAM_MODEL
  const model = typeof configured === 'string' && configured.trim() ? configured.trim() : undefined
  return { model, allowModelUpgrade: deepgramModelUpgradeEnabled(env) }
}
export const SPARK_PROCESS_ALIAS = 'gpt-5.3-spark'
export const COMPOUND_FALLBACK_MODEL = 'groq/compound'
export const VOICE_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
export const VOICE_SCOPES = ['voice:transcribe', 'voice:process', 'voice:capabilities'] as const

export const VOICE_ENDPOINTS = {
  bootstrap: '/voice/bootstrap',
  capabilities: '/voice/capabilities',
  transcriptions: '/audio/transcriptions',
  process: '/voice/process',
} as const

export function voiceUrl(path: string, baseUrl: string = VOICE_GATEWAY_BASE_URL): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

export function isVoiceScope(scope: string): boolean {
  return (VOICE_SCOPES as readonly string[]).includes(scope)
}

export function assertVoiceOnlyScopes(scopes: readonly string[]): void {
  for (const scope of scopes) {
    if (!isVoiceScope(scope)) {
      throw new Error(`Voice token cannot include scope ${scope}`)
    }
  }
}
