import {
  ROCKS_T1_MODEL_ID,
  ROCKS_T1_UPSTREAM_MODEL,
  VOICE_ENDPOINTS,
  voiceUrl,
} from '../contracts.ts'
import type { VoiceCapabilities } from '../capabilities.ts'
import type { VoiceIdentityClient } from '../identity.ts'
import {
  AudioValidationError,
  normalizeVerboseJson,
  sha256HexAsync,
  validateAudioLimits,
  type NormalizedTranscript,
} from './audio-result.ts'

export class RoxTranscriptionError extends Error {
  readonly code: 'unauthorized' | 'forbidden' | 'too-large' | 'rate-limited' | 'timeout' | 'upstream' | 'no-speech' | 'cancelled'
  readonly retryAfterMs?: number
  readonly status?: number
  constructor(code: RoxTranscriptionError['code'], message: string, extra: { retryAfterMs?: number; status?: number } = {}) {
    super(message)
    this.name = 'RoxTranscriptionError'
    this.code = code
    this.retryAfterMs = extra.retryAfterMs
    this.status = extra.status
  }
}

export interface TranscriptionRequest {
  audio: Uint8Array
  mimeType?: string
  language?: string
  wordTimestamps?: boolean
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface TranscriptionHttp { fetch(input: string, init: RequestInit): Promise<Response> }

export interface RoxTranscriptionOptions {
  baseUrl?: string
  capabilities: VoiceCapabilities
  identity: VoiceIdentityClient
  http: TranscriptionHttp
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
}

function languageParam(language: string | undefined, catalog: { code: string }[]): string | undefined {
  if (!language || language === 'auto') return undefined
  if (catalog.length > 0 && !catalog.some((item) => item.code === language)) {
    throw new AudioValidationError('damaged', `Language ${language} is not in the catalog`)
  }
  return language
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1000
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000)
  return 1000
}

export class RoxTranscriptionAdapter {
  readonly engine = 'cloud-rox' as const
  constructor(private readonly options: RoxTranscriptionOptions) {}

  async transcribe(input: TranscriptionRequest): Promise<NormalizedTranscript> {
    const caps = this.options.capabilities
    if (caps.killSwitch || caps.availability === 'unavailable') {
      throw new RoxTranscriptionError('upstream', 'Voice route is unavailable')
    }
    if (caps.quota.asr.remaining <= 0) throw new RoxTranscriptionError('rate-limited', 'ASR quota exhausted')
    const mime = validateAudioLimits(input.audio, { maxBytes: caps.maxBytes, allowedMime: caps.allowedMime }, input.mimeType)
    const language = languageParam(input.language, caps.languages)
    const idempotencyKey = input.idempotencyKey ?? await sha256HexAsync(input.audio)
    const maxRetries = this.options.maxRetries ?? 2
    let attempt = 0
    let refreshed = false
    while (true) {
      if (input.signal?.aborted) throw new RoxTranscriptionError('cancelled', 'Transcription cancelled')
      try {
        return await this.once(input.audio, mime, language, input.wordTimestamps === true, idempotencyKey, input.signal)
      } catch (error) {
        if (error instanceof RoxTranscriptionError && error.code === 'unauthorized' && !refreshed) {
          await this.options.identity.refresh()
          refreshed = true
          continue
        }
        if (error instanceof RoxTranscriptionError && (error.code === 'forbidden' || error.code === 'too-large' || error.code === 'cancelled')) throw error
        if (error instanceof RoxTranscriptionError && (error.code === 'rate-limited' || error.code === 'timeout' || error.code === 'upstream') && attempt < maxRetries) {
          attempt += 1
          await (this.options.sleep ?? delay)(error.retryAfterMs ?? 250 * attempt)
          continue
        }
        throw error
      }
    }
  }

  private async once(
    audio: Uint8Array,
    mime: string,
    language: string | undefined,
    wordTimestamps: boolean,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<NormalizedTranscript> {
    const token = await this.options.identity.bearer()
    const form = new FormData()
    const fileBytes = audio.buffer instanceof ArrayBuffer
      ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
      : new Uint8Array(audio)
    form.append('file', new Blob([fileBytes], { type: mime }), 'audio')
    form.append('model', ROCKS_T1_MODEL_ID)
    form.append('response_format', 'verbose_json')
    const granularities = wordTimestamps && this.options.capabilities.timestampGranularities.includes('word') ? ['segment', 'word'] : ['segment']
    for (const item of granularities) form.append('timestamp_granularities[]', item)
    if (language) form.append('language', language)
    const response = await this.options.http.fetch(voiceUrl(VOICE_ENDPOINTS.transcriptions, this.options.baseUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
      body: form,
      signal,
    })
    const requestId = response.headers.get('x-request-id') ?? idempotencyKey
    if (response.status === 401) throw new RoxTranscriptionError('unauthorized', 'Token expired', { status: 401 })
    if (response.status === 403) throw new RoxTranscriptionError('forbidden', 'Token is not allowed to transcribe', { status: 403 })
    if (response.status === 413) throw new RoxTranscriptionError('too-large', 'Audio exceeds provider limit', { status: 413 })
    if (response.status === 429) {
      throw new RoxTranscriptionError('rate-limited', 'Rate limited', { status: 429, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) })
    }
    if (response.status >= 500) throw new RoxTranscriptionError('upstream', `Upstream ${response.status}`, { status: response.status })
    if (!response.ok) throw new RoxTranscriptionError('upstream', `Transcription failed (${response.status})`, { status: response.status })
    const json = await response.json()
    const result = normalizeVerboseJson(json, {
      requestedModelId: ROCKS_T1_MODEL_ID,
      resolvedModelId: typeof (json as { model?: string }).model === 'string' ? (json as { model: string }).model : ROCKS_T1_UPSTREAM_MODEL,
      routeVersion: this.options.capabilities.routeVersion,
      requestId,
    })
    if (result.noSpeech) return result
    if (!result.text.trim()) throw new RoxTranscriptionError('upstream', 'Empty ASR payload is not success')
    return result
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
