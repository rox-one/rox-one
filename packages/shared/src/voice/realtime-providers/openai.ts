/**
 * OpenAI Realtime adapter — a real implementation of the documented WebSocket
 * realtime protocol for both voice bridges and transcription relays.
 *
 * Voice bridge (documented): connect `wss://api.openai.com/v1/realtime?model=…`,
 * send `session.update`, append PCM16 via `input_audio_buffer.append`, receive
 * `response.audio.delta` / `response.audio_transcript.*`, cancel a response with
 * `response.cancel` for barge-in. Transcription: `?intent=transcription` with
 * `input_audio_transcription` and `conversation.item.input_audio_transcription.*`.
 *
 * The socket factory is injectable so the protocol is verified against a local
 * fixture server in tests. Live provider calls are out of scope (no network) and
 * every browser-session call is a real REST round-trip, never a fabricated token.
 *
 * Provenance: OpenClaw `extensions/openai/realtime-voice-bridge.ts`,
 * `realtime-voice-protocol.ts`, `realtime-voice-events.ts` (ledger d1.3/d1.5).
 */

import type {
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCallbacks,
  RealtimeVoiceBridgeConfig,
  RealtimeVoiceRole,
} from '../realtime-bridge-types.ts'
import { RealtimeVoiceSessionLifecycle, type RealtimeTimerScheduler } from '../realtime-bridge.ts'
import type {
  RealtimeBrowserSession,
  RealtimeBrowserSessionRequest,
  RealtimeVoiceProvider,
  SpeechProvider,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  VoiceProviderCapabilities,
} from '../provider-registry.ts'
import type {
  RealtimeSocket,
  RealtimeSocketHandlers,
  RealtimeSocketOpener,
  RealtimeTranscriptionEvent,
  RealtimeTranscriptionSession,
} from '../realtime-transcription.ts'
import { createRealtimeTranscriptionSession } from '../realtime-transcription.ts'

export const OPENAI_PROVIDER_ID = 'openai'
export const OPENAI_REALTIME_BASE_URL = 'https://api.openai.com'
export const OPENAI_REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime'
export const OPENAI_REALTIME_MODEL = 'gpt-4o-realtime-preview'
export const OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'

export const OPENAI_CAPABILITIES: VoiceProviderCapabilities = {
  streaming: true,
  bargeIn: true,
  toolCalls: true,
  browserSession: true,
  languages: ['en', 'ru'],
}

export const OPENAI_SPEECH_CAPABILITIES: VoiceProviderCapabilities = {
  streaming: false,
  bargeIn: false,
  toolCalls: false,
  browserSession: false,
  languages: ['en', 'ru'],
}

/** Minimal structural socket contract; Bun/Node globals are cast into it. */
interface GlobalWebSocketLike {
  readonly readyState: number
  binaryType: string
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number; reason?: string }) => void): void
}

type GlobalWebSocketCtor = new (url: string, options?: { headers?: Record<string, string> }) => GlobalWebSocketLike

/** Real browser/Node socket opener; the default for production bridges. */
export const openGlobalWebSocket: RealtimeSocketOpener = (url, headers, handlers: RealtimeSocketHandlers): RealtimeSocket => {
  // The runtime `WebSocket` global is untyped under `lib: ESNext`; the structural
  // contract above is verified on first use.
  const runtimeGlobals = globalThis as unknown as { WebSocket?: GlobalWebSocketCtor }
  const ctor = runtimeGlobals.WebSocket
  if (!ctor) throw new Error('This runtime has no WebSocket implementation')
  const socket = new ctor(url, headers ? { headers } : undefined)
  socket.binaryType = 'arraybuffer'
  socket.addEventListener('open', () => handlers.onOpen())
  socket.addEventListener('message', (event) => {
    const data = event.data
    if (typeof data === 'string') handlers.onMessage(data)
    else if (data instanceof ArrayBuffer) handlers.onMessage(new Uint8Array(data))
    else if (ArrayBuffer.isView(data)) handlers.onMessage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  })
  socket.addEventListener('close', (event) => handlers.onClose(event.code ?? 1000, event.reason ?? ''))
  socket.addEventListener('error', () => handlers.onError(new Error('realtime socket error')))
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    get readyState() {
      return socket.readyState === 1 ? 'open' : socket.readyState === 0 ? 'connecting' : 'closed'
    },
  }
}

export interface OpenAiRealtimeOptions {
  apiKey?: string
  model?: string
  voice?: string
  instructions?: string
  baseUrl?: string
  wsUrl?: string
  openSocket?: RealtimeSocketOpener
  connectTimeoutMs?: number
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  now?: () => number
  schedule?: RealtimeTimerScheduler
  fetch?: typeof fetch
}

export interface OpenAiRealtimeServerEvent {
  type: string
  [key: string]: unknown
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

/** Runtime-checked narrowing of a parsed/network value; the cast is guarded above. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

export function encodeAudioAppend(chunk: Uint8Array): string {
  return JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(chunk) })
}

export function parseServerEvent(raw: string | Uint8Array): OpenAiRealtimeServerEvent | null {
  let text: string
  if (typeof raw === 'string') text = raw
  else {
    try { text = new TextDecoder().decode(raw) } catch { return null }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    const record = asRecord(parsed)
    if (!record) return null
    const type = stringField(record, 'type')
    return type ? { ...record, type } : null
  } catch {
    return null
  }
}

function sessionUpdatePayload(options: OpenAiRealtimeOptions, config: RealtimeVoiceBridgeConfig): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      modalities: ['audio', 'text'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      turn_detection: { type: 'server_vad' },
      // The beta default is transcription-off; the bridge and the user-transcript
      // handler both consume `conversation.item.input_audio_transcription.*`, so
      // enable it with the same model as the transcription relay.
      input_audio_transcription: { model: options.model ?? OPENAI_TRANSCRIPTION_MODEL },
      ...(options.instructions ?? config.instructions ? { instructions: options.instructions ?? config.instructions } : {}),
      ...(options.voice ?? config.voice ? { voice: options.voice ?? config.voice } : {}),
    },
  })
}

/**
 * OpenAI realtime voice bridge. Owns the reconnect lifecycle (backoff + connect
 * timeout) and the pending-audio queue; opens the socket whenever the lifecycle
 * re-enters `connecting`.
 */
class OpenAiRealtimeBridge implements RealtimeVoiceBridge {
  readonly outputAudioMode = 'per-response' as const
  private readonly lifecycle: RealtimeVoiceSessionLifecycle
  private socket: RealtimeSocket | null = null
  private closing = false
  private readonly openSocket: RealtimeSocketOpener

  constructor(
    private readonly callbacks: RealtimeVoiceBridgeCallbacks,
    private readonly config: RealtimeVoiceBridgeConfig,
    private readonly options: OpenAiRealtimeOptions,
  ) {
    this.openSocket = options.openSocket ?? openGlobalWebSocket
    this.lifecycle = new RealtimeVoiceSessionLifecycle({
      sessionId: config.sessionId,
      maxAttempts: options.maxAttempts ?? 5,
      baseDelayMs: options.baseDelayMs ?? 500,
      maxDelayMs: options.maxDelayMs ?? 8_000,
      connectTimeoutMs: options.connectTimeoutMs ?? 15_000,
      now: options.now,
      schedule: options.schedule,
      onChange: (snapshot) => {
        if (snapshot.state === 'connecting') this.open()
        else if (snapshot.state === 'terminal') this.callbacks.onClose?.()
      },
    })
  }

  private open(): void {
    if (this.closing) return
    const key = this.options.apiKey ?? ''
    // Every handler is bound to the socket instance that fired it; a superseded
    // socket (retry replaced it) can still emit open/close/error afterwards and
    // must never touch the live session's state, handshake or queued audio.
    const socket = this.openSocket(this.wsUrl(), {
      Authorization: `Bearer ${key}`,
      'OpenAI-Beta': 'realtime=v1',
    }, {
      onOpen: () => {
        if (this.socket !== socket) {
          try { socket.close(1000, 'superseded') } catch { /* already closed */ }
          return
        }
        this.sendRaw(sessionUpdatePayload(this.options, this.config))
        this.lifecycle.markReady()
        this.callbacks.onReady?.()
        this.flushPending()
      },
      onMessage: (data) => { if (this.socket === socket) this.handleMessage(data) },
      onClose: (code, reason) => {
        if (this.socket !== socket) return
        this.socket = null
        if (this.closing) return
        this.callbacks.onClose?.()
        this.lifecycle.fail(new Error(reason || `realtime socket closed (${code})`))
      },
      onError: (error) => {
        if (this.socket !== socket) return
        this.callbacks.onError?.(error)
        if (!this.closing) this.lifecycle.fail(error)
      },
    })
    const previous = this.socket
    this.socket = socket
    if (previous && previous !== socket) {
      try { previous.close(1000, 'superseded') } catch { /* already closed */ }
    }
  }

  private wsUrl(): string {
    const base = this.options.wsUrl ?? OPENAI_REALTIME_WS_URL
    const model = this.options.model ?? OPENAI_REALTIME_MODEL
    return `${base}?model=${encodeURIComponent(model)}`
  }

  private sendRaw(payload: string): void {
    if (this.socket?.readyState !== 'open') return
    this.socket.send(payload)
  }

  private flushPending(): void {
    // Draining while not connected would discard the queue into a socket that
    // never handshook; keep the frames queued for the next ready transition.
    if (this.lifecycle.snapshot().state !== 'ready') return
    for (const chunk of this.lifecycle.drainPending()) this.sendRaw(encodeAudioAppend(chunk))
  }

  private emitTranscript(role: RealtimeVoiceRole, text: string, isFinal: boolean, textMode: 'delta' | 'full'): void {
    this.callbacks.onTranscript(role, text, isFinal, { textMode })
  }

  private handleMessage(data: string | Uint8Array): void {
    const event = parseServerEvent(data)
    if (!event) return
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        return
      case 'response.audio.delta': {
        const delta = event.delta
        if (typeof delta === 'string') this.callbacks.onAudio(fromBase64(delta))
        return
      }
      case 'response.audio_transcript.delta': {
        const delta = event.delta
        if (typeof delta === 'string') this.emitTranscript('assistant', delta, false, 'delta')
        return
      }
      case 'response.audio_transcript.done': {
        const transcript = event.transcript
        if (typeof transcript === 'string') this.emitTranscript('assistant', transcript, true, 'full')
        return
      }
      case 'response.text.delta': {
        const delta = event.delta
        if (typeof delta === 'string') this.emitTranscript('assistant', delta, false, 'delta')
        return
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = event.transcript
        if (typeof transcript === 'string') this.emitTranscript('user', transcript, true, 'full')
        return
      }
      case 'response.function_call_arguments.done': {
        const callId = event.call_id
        const name = event.name
        if (typeof callId === 'string' && typeof name === 'string') {
          let args: unknown = event.arguments
          if (typeof args === 'string') {
            try { args = JSON.parse(args) } catch { /* keep the raw string */ }
          }
          this.callbacks.onToolCall?.({ callId, name, args })
        }
        return
      }
      case 'response.done': {
        const status = stringField(asRecord(event.response), 'status')
        this.callbacks.onResponseDone?.(status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed')
        return
      }
      case 'input_audio_buffer.speech_started':
        this.callbacks.onClearAudio('barge-in')
        return
      case 'error': {
        const message = stringField(asRecord(event.error), 'message')
        this.callbacks.onError?.(new Error(message ?? 'realtime provider error'))
        return
      }
      default:
        return
    }
  }

  async connect(): Promise<void> {
    this.lifecycle.connect()
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.lifecycle.snapshot().state === 'ready') {
      this.sendRaw(encodeAudioAppend(chunk))
      return
    }
    this.lifecycle.sendAudio(chunk)
  }

  sendUserMessage(text: string): void {
    this.sendRaw(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    }))
    this.sendRaw(JSON.stringify({ type: 'response.create' }))
  }

  submitToolResult(callId: string, result: unknown): void {
    this.sendRaw(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result ?? null) },
    }))
    this.sendRaw(JSON.stringify({ type: 'response.create' }))
  }

  handleBargeIn(): void {
    this.sendRaw(JSON.stringify({ type: 'response.cancel' }))
    this.flushClear()
  }

  private flushClear(): void {
    this.callbacks.onClearAudio('barge-in')
  }

  close(): void {
    this.closing = true
    this.lifecycle.close('client-close')
    const socket = this.socket
    this.socket = null
    try { socket?.close(1000, 'client-close') } catch { /* already closed */ }
  }
}

export interface OpenAiProviderOptions extends OpenAiRealtimeOptions {
  /** Overrides the service-key read; tests inject a resolver. */
  getApiKey?: () => string | undefined
}

function configuredKey(options: OpenAiProviderOptions): string | undefined {
  const key = options.apiKey ?? options.getApiKey?.()
  return key && key.trim() ? key.trim() : undefined
}

export function createOpenAiRealtimeVoiceProvider(options: OpenAiProviderOptions = {}): RealtimeVoiceProvider {
  return {
    id: OPENAI_PROVIDER_ID,
    displayName: 'OpenAI Realtime',
    capabilities: OPENAI_CAPABILITIES,
    isConfigured: () => configuredKey(options) !== undefined,
    async createBridge(callbacks, config) {
      const key = configuredKey(options)
      if (!key) throw new Error('OpenAI realtime is not configured')
      const bridge = new OpenAiRealtimeBridge(callbacks, config, { ...options, apiKey: key })
      await bridge.connect()
      return bridge
    },
    async createBrowserSession(request: RealtimeBrowserSessionRequest): Promise<RealtimeBrowserSession> {
      const key = configuredKey(options)
      if (!key) throw new Error('OpenAI realtime is not configured')
      const doFetch = options.fetch ?? fetch
      const response = await doFetch(`${options.baseUrl ?? OPENAI_REALTIME_BASE_URL}/v1/realtime/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', 'OpenAI-Beta': 'realtime=v1' },
        body: JSON.stringify({
          model: request.model ?? options.model ?? OPENAI_REALTIME_MODEL,
          voice: request.voice ?? options.voice,
          modalities: ['audio', 'text'],
          ...(request.instructions ? { instructions: request.instructions } : {}),
        }),
      })
      if (!response.ok) throw new Error(`OpenAI realtime session failed with status ${response.status}`)
      const payload = asRecord(await response.json())
      const clientSecret = asRecord(payload?.client_secret)
      const value = stringField(clientSecret, 'value')
      const expiresAt = clientSecret?.expires_at
      if (!value) throw new Error('OpenAI realtime session returned no client secret')
      return {
        clientSecret: value,
        expiresAt: typeof expiresAt === 'number' ? expiresAt * 1000 : Date.now() + 60_000,
        model: stringField(payload, 'model'),
      }
    },
  }
}

function transcriptionHandshake(options: OpenAiProviderOptions): string {
  return JSON.stringify({
    type: 'session.update',
    session: {
      input_audio_format: 'pcm16',
      input_audio_transcription: { model: options.model ?? OPENAI_TRANSCRIPTION_MODEL },
      turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
    },
  })
}

export function decodeOpenAiTranscriptionEvent(raw: string | Uint8Array): RealtimeTranscriptionEvent | null {
  const event = parseServerEvent(raw)
  if (!event) return null
  switch (event.type) {
    case 'conversation.item.input_audio_transcription.delta':
      return typeof event.delta === 'string' ? { kind: 'partial', text: event.delta, sequence: 0 } : null
    case 'conversation.item.input_audio_transcription.completed':
      return typeof event.transcript === 'string' ? { kind: 'transcript', text: event.transcript, final: true, sequence: 0 } : null
    case 'input_audio_buffer.speech_started':
      return { kind: 'speechStart', sequence: 0 }
    case 'error': {
      const message = stringField(asRecord(event.error), 'message')
      return { kind: 'error', error: message ?? 'realtime provider error', sequence: 0 }
    }
    default:
      return null
  }
}

export interface OpenAiTranscriptionOptions extends OpenAiProviderOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  connectTimeoutMs?: number
  now?: () => number
  schedule?: RealtimeTimerScheduler
}

/** Real OpenAI realtime transcription session (`?intent=transcription`). */
export function createOpenAiRealtimeTranscriptionSession(options: OpenAiTranscriptionOptions = {}): RealtimeTranscriptionSession {
  const key = configuredKey(options)
  if (!key) throw new Error('OpenAI transcription is not configured')
  const base = options.wsUrl ?? OPENAI_REALTIME_WS_URL
  return createRealtimeTranscriptionSession({
    url: `${base}?intent=transcription`,
    headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': 'realtime=v1' },
    open: options.openSocket ?? openGlobalWebSocket,
    handshake: () => transcriptionHandshake(options),
    encodeAudio: encodeAudioAppend,
    decodeMessage: decodeOpenAiTranscriptionEvent,
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    connectTimeoutMs: options.connectTimeoutMs,
    now: options.now,
    schedule: options.schedule,
  })
}

/**
 * OpenAI TTS over the speech endpoint is not streamed; the buffered adapter is
 * provided for completeness of the speech-provider surface. Live synthesis is
 * out of scope for the wave (no network in tests).
 */
export function createOpenAiSpeechProvider(options: OpenAiProviderOptions = {}): SpeechProvider {
  return {
    id: OPENAI_PROVIDER_ID,
    displayName: 'OpenAI Speech',
    capabilities: OPENAI_SPEECH_CAPABILITIES,
    isConfigured: () => configuredKey(options) !== undefined,
    async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
      const key = configuredKey(options)
      if (!key) throw new Error('OpenAI speech is not configured')
      const doFetch = options.fetch ?? fetch
      const response = await doFetch(`${options.baseUrl ?? OPENAI_REALTIME_BASE_URL}/v1/audio/speech`, {
        method: 'POST',
        signal: input.signal,
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model ?? 'gpt-4o-mini-tts',
          voice: input.voice ?? options.voice ?? 'alloy',
          input: input.text,
          response_format: 'mp3',
        }),
      })
      if (!response.ok) throw new Error(`OpenAI speech failed with status ${response.status}`)
      return {
        audioBuffer: new Uint8Array(await response.arrayBuffer()),
        outputFormat: 'mp3',
        fileExtension: 'mp3',
        voiceCompatible: false,
      }
    },
  }
}