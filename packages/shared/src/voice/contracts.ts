/** Staging Voice Gateway contract. Public client id is not a secret. */

export const VOICE_GATEWAY_BASE_URL = 'https://api.rox.one/v1'
export const VOICE_PUBLIC_CLIENT_ID = 'rox-desktop-voice'
export const ROCKS_T1_MODEL_ID = 'rocks-t1'
export const ROCKS_T1_DISPLAY_NAME = 'rocks transcription (rocks t1)'
export const ROCKS_T1_UPSTREAM_MODEL = 'whisper-large-v3-turbo'
export const ROCKS_T1_ROUTE = 'rox-ultra'
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
