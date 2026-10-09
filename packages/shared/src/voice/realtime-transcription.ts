/**
 * Realtime (WebSocket) speech-to-text relay session.
 *
 * Owns connect → handshake → ready, a bounded outbound audio queue that survives
 * a reconnect, and bounded retry with backoff. The wire protocol (frame shapes,
 * handshake payload) is supplied by a provider adapter; this module only drives
 * the socket and normalizes provider frames into a monotonic event stream.
 *
 * Provenance: OpenClaw `src/realtime-transcription/provider-types.ts`,
 * `src/realtime-transcription/websocket-session.ts` (clean-room re-expression; ledger d1.5).
 */

import type { RealtimeTimerScheduler } from './realtime-bridge.ts'
import { createRealtimeVoiceAudioQueue, REALTIME_AUDIO_QUEUE_MAX_BYTES, REALTIME_AUDIO_QUEUE_MAX_CHUNKS } from './realtime-bridge.ts'

export type RealtimeTranscriptionEventKind = 'ready' | 'partial' | 'transcript' | 'speechStart' | 'error' | 'close'

export interface RealtimeTranscriptionEvent {
  kind: RealtimeTranscriptionEventKind
  text?: string
  final?: boolean
  sequence: number
  error?: string
}

export type RealtimeSocketReadyState = 'connecting' | 'open' | 'closed'

export interface RealtimeSocket {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  readonly readyState: RealtimeSocketReadyState
}

export interface RealtimeSocketHandlers {
  onOpen(): void
  onMessage(data: string | Uint8Array): void
  onClose(code: number, reason: string): void
  onError(error: Error): void
}

export type RealtimeSocketOpener = (
  url: string,
  headers: Record<string, string> | undefined,
  handlers: RealtimeSocketHandlers,
) => RealtimeSocket

export interface RealtimeTranscriptionSessionOptions {
  url: string
  headers?: Record<string, string>
  open: RealtimeSocketOpener
  /** Frame sent once the socket opens (provider handshake). */
  handshake?: () => string | Uint8Array
  /** Encode one PCM chunk into the provider's append frame. */
  encodeAudio: (chunk: Uint8Array) => string | Uint8Array
  /** Translate provider frames into zero or more normalized events. */
  decodeMessage: (data: string | Uint8Array) => RealtimeTranscriptionEvent[] | RealtimeTranscriptionEvent | null
  maxChunks?: number
  maxBytes?: number
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  now?: () => number
  schedule?: RealtimeTimerScheduler
}

export interface RealtimeTranscriptionSession {
  connect(): Promise<void>
  sendAudio(chunk: Uint8Array): void
  close(reason?: string): void
  isConnected(): boolean
  queued(): { chunks: number; bytes: number; droppedChunks: number }
  onPartial(callback: (text: string) => void): () => void
  onTranscript(callback: (text: string, final: boolean) => void): () => void
  onSpeechStart(callback: () => void): () => void
  onEvent(callback: (event: RealtimeTranscriptionEvent) => void): () => void
}

export function createRealtimeTranscriptionSession(
  options: RealtimeTranscriptionSessionOptions,
): RealtimeTranscriptionSession {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, ms) => {
    const timer = setTimeout(callback, ms)
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    return () => clearTimeout(timer)
  })
  const maxAttempts = options.maxAttempts ?? 5
  const baseDelayMs = options.baseDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 8_000
  const queue = createRealtimeVoiceAudioQueue({ maxChunks: options.maxChunks ?? REALTIME_AUDIO_QUEUE_MAX_CHUNKS, maxBytes: options.maxBytes ?? REALTIME_AUDIO_QUEUE_MAX_BYTES })
  const partialListeners = new Set<(text: string) => void>()
  const transcriptListeners = new Set<(text: string, final: boolean) => void>()
  const speechStartListeners = new Set<() => void>()
  const eventListeners = new Set<(event: RealtimeTranscriptionEvent) => void>()
  let socket: RealtimeSocket | null = null
  let sequence = 0
  let attempt = 0
  let closed = false
  let cancelTimer: (() => void) | undefined

  const emit = (event: Omit<RealtimeTranscriptionEvent, 'sequence'>): void => {
    sequence += 1
    const full: RealtimeTranscriptionEvent = { ...event, sequence }
    for (const listener of eventListeners) listener(full)
    if (full.kind === 'partial' && full.text !== undefined) for (const listener of partialListeners) listener(full.text)
    if (full.kind === 'transcript' && full.text !== undefined) for (const listener of transcriptListeners) listener(full.text, full.final === true)
    if (full.kind === 'speechStart') for (const listener of speechStartListeners) listener()
  }

  const flush = (current: RealtimeSocket): void => {
    for (const chunk of queue.drain(now())) {
      try {
        current.send(options.encodeAudio(chunk))
      } catch {
        return
      }
    }
  }

  const openSocket = (): void => {
    socket = options.open(options.url, options.headers, {
      onOpen() {
        if (closed) return
        attempt = 0
        if (options.handshake) socket?.send(options.handshake())
        emit({ kind: 'ready' })
        if (socket) flush(socket)
      },
      onMessage(data) {
        if (closed) return
        const decoded = options.decodeMessage(data)
        if (!decoded) return
        for (const event of Array.isArray(decoded) ? decoded : [decoded]) {
          emit({ kind: event.kind, text: event.text, final: event.final, error: event.error })
        }
      },
      onClose(code, reason) {
        if (closed) return
        socket = null
        attempt += 1
        emit({ kind: 'close', error: reason || `socket closed (${code})` })
        if (attempt >= maxAttempts) {
          emit({ kind: 'error', error: 'realtime transcription relay exhausted its reconnect attempts' })
          closed = true
          return
        }
        cancelTimer = schedule(openSocket, Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)))
      },
      onError(error) {
        if (closed) return
        emit({ kind: 'error', error: error.message })
      },
    })
  }

  return {
    connect() {
      if (closed || socket) return Promise.resolve()
      cancelTimer?.()
      openSocket()
      return Promise.resolve()
    },
    sendAudio(chunk) {
      if (closed) return
      if (socket?.readyState === 'open') {
        socket.send(options.encodeAudio(chunk))
        return
      }
      queue.enqueue(chunk, now())
    },
    close(reason) {
      if (closed) return
      closed = true
      cancelTimer?.()
      cancelTimer = undefined
      const current = socket
      socket = null
      emit({ kind: 'close', error: reason })
      try { current?.close(1000, reason ?? 'client-close') } catch { /* already closed */ }
    },
    isConnected: () => socket?.readyState === 'open',
    queued: () => ({ chunks: queue.size, bytes: queue.bytes, droppedChunks: queue.droppedChunks }),
    onPartial(callback) { partialListeners.add(callback); return () => partialListeners.delete(callback) },
    onTranscript(callback) { transcriptListeners.add(callback); return () => transcriptListeners.delete(callback) },
    onSpeechStart(callback) { speechStartListeners.add(callback); return () => speechStartListeners.delete(callback) },
    onEvent(callback) { eventListeners.add(callback); return () => eventListeners.delete(callback) },
  }
}