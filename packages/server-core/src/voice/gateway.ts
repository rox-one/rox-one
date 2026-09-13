import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  LAST_KNOWN_GOOD_VOICE_CAPABILITIES,
  ROX_VOICE_BOOTSTRAP_PATH,
  ROX_VOICE_CAPABILITIES_PATH,
  ROX_VOICE_GATEWAY_BASE_URL,
  ROX_VOICE_PUBLIC_CLIENT_ID,
  ROX_VOICE_PUBLIC_MODEL_ID,
  ROX_VOICE_TRANSCRIPTIONS_PATH,
  ROX_VOICE_UPSTREAM_ASR_MODEL,
  VoicePrivacyError,
  parseVoiceCapabilities,
  rememberVoiceCapabilities,
  scopesAreVoiceOnly,
  type TranscribeInput,
  type TranscribeResult,
  type VoiceBootstrapResponse,
  type VoiceCapabilities,
} from '@craft-agent/shared/voice'
import { atomicWriteFileSync, readJsonFileSync } from '@craft-agent/shared/utils/files'
import { resolveConfigDir } from '@craft-agent/shared/config'

export const VOICE_IDENTITY_FILE = 'voice-identity.json'

export type VoiceFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: BodyInit
    signal?: AbortSignal
  },
) => Promise<Response>

export interface VoiceIdentity {
  installationId: string
  accessToken?: string
  expiresAt?: number
  refreshToken?: string
  scopes?: string[]
}

export interface VoiceGatewayDeps {
  fetch: VoiceFetch
  baseUrl?: string
  configDir?: string
  env?: NodeJS.ProcessEnv
  now?: () => number
  platform?: string
  appVersion?: string
}

export function getVoiceIdentityPath(configDir: string = resolveConfigDir()): string {
  return join(configDir, VOICE_IDENTITY_FILE)
}

export function loadVoiceIdentity(configDir: string = resolveConfigDir()): VoiceIdentity {
  try {
    const path = getVoiceIdentityPath(configDir)
    if (!existsSync(path)) {
      return { installationId: randomUUID() }
    }
    const raw = readJsonFileSync<Record<string, unknown>>(path)
    const installationId =
      typeof raw.installationId === 'string' && raw.installationId
        ? raw.installationId
        : randomUUID()
    return {
      installationId,
      accessToken: typeof raw.accessToken === 'string' ? raw.accessToken : undefined,
      expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : undefined,
      refreshToken: typeof raw.refreshToken === 'string' ? raw.refreshToken : undefined,
      scopes: Array.isArray(raw.scopes)
        ? raw.scopes.filter((scope): scope is string => typeof scope === 'string')
        : undefined,
    }
  } catch {
    return { installationId: randomUUID() }
  }
}

export function saveVoiceIdentity(
  identity: VoiceIdentity,
  configDir: string = resolveConfigDir(),
): VoiceIdentity {
  const path = getVoiceIdentityPath(configDir)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, `${JSON.stringify(identity, null, 2)}\n`)
  return identity
}

function gatewayUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function envVoiceToken(env: NodeJS.ProcessEnv): string | undefined {
  const voice = env.ROX_VOICE_TOKEN?.trim()
  return voice || undefined
}

function envApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const api = env.ROX_API_KEY?.trim()
  return api || undefined
}

export function createDefaultGatewayDeps(overrides: Partial<VoiceGatewayDeps> = {}): VoiceGatewayDeps {
  return {
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init as RequestInit)),
    baseUrl: overrides.baseUrl,
    configDir: overrides.configDir,
    env: overrides.env,
    now: overrides.now,
    platform: overrides.platform,
    appVersion: overrides.appVersion,
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function resolveVoiceAccessToken(
  deps: VoiceGatewayDeps,
): Promise<{ token: string; identity: VoiceIdentity; source: 'env' | 'stored' | 'bootstrap' }> {
  const env = deps.env ?? process.env
  const configDir = deps.configDir ?? resolveConfigDir()
  const now = deps.now?.() ?? Date.now()
  const identity = loadVoiceIdentity(configDir)
  saveVoiceIdentity(identity, configDir)

  const fromVoiceEnv = envVoiceToken(env)
  if (fromVoiceEnv) return { token: fromVoiceEnv, identity, source: 'env' }

  if (
    identity.accessToken &&
    identity.expiresAt &&
    identity.expiresAt - 30_000 > now &&
    scopesAreVoiceOnly(identity.scopes ?? ['voice.transcribe'])
  ) {
    return { token: identity.accessToken, identity, source: 'stored' }
  }

  const fromApiKey = envApiKey(env)
  if (fromApiKey) return { token: fromApiKey, identity, source: 'env' }

  const bootstrapped = await tryBootstrap(deps, identity)
  if (bootstrapped) return bootstrapped

  throw new VoicePrivacyError(
    'cloud-stt-unauthorized',
    'Cloud speech is unavailable: no scoped voice token',
  )
}

async function tryBootstrap(
  deps: VoiceGatewayDeps,
  identity: VoiceIdentity,
): Promise<{ token: string; identity: VoiceIdentity; source: 'bootstrap' } | null> {
  const baseUrl = deps.baseUrl ?? ROX_VOICE_GATEWAY_BASE_URL
  const configDir = deps.configDir ?? resolveConfigDir()
  try {
    const response = await deps.fetch(gatewayUrl(baseUrl, ROX_VOICE_BOOTSTRAP_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: ROX_VOICE_PUBLIC_CLIENT_ID,
        installationId: identity.installationId,
        platform: deps.platform ?? process.platform,
        appVersion: deps.appVersion ?? 'unknown',
      }),
    })
    if (response.status === 404) return null
    if (!response.ok) return null
    const body = await parseJson(response) as VoiceBootstrapResponse | null
    if (!body?.accessToken || !Array.isArray(body.scopes) || !scopesAreVoiceOnly(body.scopes)) {
      return null
    }
    const next: VoiceIdentity = {
      installationId: body.installationId || identity.installationId,
      accessToken: body.accessToken,
      expiresAt: body.expiresAt,
      refreshToken: body.refreshToken,
      scopes: body.scopes,
    }
    saveVoiceIdentity(next, configDir)
    return { token: body.accessToken, identity: next, source: 'bootstrap' }
  } catch {
    return null
  }
}

export async function fetchVoiceCapabilities(
  deps: VoiceGatewayDeps,
  token: string,
): Promise<VoiceCapabilities> {
  const baseUrl = deps.baseUrl ?? ROX_VOICE_GATEWAY_BASE_URL
  try {
    const response = await deps.fetch(gatewayUrl(baseUrl, ROX_VOICE_CAPABILITIES_PATH), {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      return parseVoiceCapabilities(null, LAST_KNOWN_GOOD_VOICE_CAPABILITIES)
    }
    return rememberVoiceCapabilities(await parseJson(response))
  } catch {
    return parseVoiceCapabilities(null, LAST_KNOWN_GOOD_VOICE_CAPABILITIES)
  }
}

function mimeToFilename(mimeType: string): string {
  if (mimeType.includes('wav')) return 'audio.wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'audio.m4a'
  if (mimeType.includes('ogg')) return 'audio.ogg'
  if (mimeType.includes('flac')) return 'audio.flac'
  return 'audio.webm'
}

function mapGatewayError(status: number): VoicePrivacyError {
  if (status === 401 || status === 403) {
    return new VoicePrivacyError('cloud-stt-unauthorized', 'Cloud speech is unauthorized')
  }
  if (status === 413) {
    return new VoicePrivacyError('cloud-stt-too-large', 'Audio is too large for cloud speech')
  }
  if (status === 429) {
    return new VoicePrivacyError('cloud-stt-quota', 'Cloud speech quota exceeded')
  }
  return new VoicePrivacyError('cloud-stt-failed', `Cloud speech failed (${status})`)
}

function asSegments(raw: unknown): TranscribeResult['segments'] {
  if (!Array.isArray(raw)) return undefined
  const segments = raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const obj = item as Record<string, unknown>
    if (typeof obj.text !== 'string') return []
    return [{
      id: typeof obj.id === 'number' ? obj.id : index,
      start: typeof obj.start === 'number' ? obj.start : 0,
      end: typeof obj.end === 'number' ? obj.end : 0,
      text: obj.text,
    }]
  })
  return segments.length > 0 ? segments : undefined
}

function asWords(raw: unknown): TranscribeResult['words'] {
  if (!Array.isArray(raw)) return undefined
  const words = raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const obj = item as Record<string, unknown>
    if (typeof obj.word !== 'string' && typeof obj.text !== 'string') return []
    return [{
      word: typeof obj.word === 'string' ? obj.word : String(obj.text),
      start: typeof obj.start === 'number' ? obj.start : 0,
      end: typeof obj.end === 'number' ? obj.end : 0,
    }]
  })
  return words.length > 0 ? words : undefined
}

export async function transcribeViaRoxGateway(
  deps: VoiceGatewayDeps,
  token: string,
  input: TranscribeInput,
): Promise<TranscribeResult> {
  const baseUrl = deps.baseUrl ?? ROX_VOICE_GATEWAY_BASE_URL
  const models = [ROX_VOICE_PUBLIC_MODEL_ID, ROX_VOICE_UPSTREAM_ASR_MODEL]
  let lastError: VoicePrivacyError | null = null
  for (const model of models) {
    const form = new FormData()
    const bytes = new Uint8Array(input.audio)
    form.append('file', new Blob([bytes], { type: input.mimeType }), mimeToFilename(input.mimeType))
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    form.append('timestamp_granularities[]', 'word')
    if (input.language) form.append('language', input.language)
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    }
    if (input.requestId) headers['Idempotency-Key'] = input.requestId
    const response = await deps.fetch(gatewayUrl(baseUrl, ROX_VOICE_TRANSCRIPTIONS_PATH), {
      method: 'POST',
      headers,
      body: form,
      signal: input.signal,
    })
    if (response.status === 404 && model === ROX_VOICE_PUBLIC_MODEL_ID) {
      lastError = mapGatewayError(response.status)
      continue
    }
    if (response.status === 429) {
      lastError = mapGatewayError(response.status)
      continue
    }
    if (!response.ok) throw mapGatewayError(response.status)
    const body = await parseJson(response) as Record<string, unknown> | null
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) {
      throw new VoicePrivacyError('empty-transcript', 'Transcript is empty')
    }
    return {
      text,
      engine: 'cloud-rox',
      uploaded: true,
      language: typeof body?.language === 'string' ? body.language : undefined,
      duration: typeof body?.duration === 'number' ? body.duration : undefined,
      modelId: typeof body?.model === 'string' ? body.model : model,
      requestId: input.requestId,
      segments: asSegments(body?.segments),
      words: asWords(body?.words),
    }
  }
  throw lastError ?? new VoicePrivacyError('cloud-stt-failed', 'Cloud speech failed')
}
