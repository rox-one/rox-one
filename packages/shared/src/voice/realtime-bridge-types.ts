/**
 * Realtime voice bridge + callbacks shared by the lifecycle machine and every
 * provider adapter. Kept separate so `realtime-bridge.ts` (FSM) and the provider
 * adapters can both depend on it without a cycle.
 *
 * Provenance: OpenClaw `src/talk/provider-types.ts` (ledger d1.3).
 */

export type RealtimeVoiceRole = 'user' | 'assistant'

export interface RealtimeVoiceBargeInDetails {
  /** `barge-in` when local playback must be cleared. */
  reason: 'barge-in'
}

export interface RealtimeVoiceTranscriptMeta {
  /** `delta` appends to the current text; `full` replaces it. */
  textMode?: 'delta' | 'full'
}

export interface RealtimeVoiceToolCall {
  callId: string
  name: string
  args: unknown
}

export interface RealtimeVoiceBridgeCallbacks {
  /** Provider audio (decoded) ready for local playback. */
  onAudio(chunk: Uint8Array): void
  getPlaybackState?(): 'idle' | 'speaking'
  /** Local playback must stop immediately (user interrupted the model). */
  onClearAudio(reason: 'barge-in'): void
  onMark?(id: string): void
  onTranscript(role: RealtimeVoiceRole, text: string, isFinal: boolean, meta?: RealtimeVoiceTranscriptMeta): void
  onResponseDone?(outcome: 'completed' | 'cancelled' | 'failed'): void
  onToolCall?(call: RealtimeVoiceToolCall): void
  onReady?(): void
  onError?(error: Error): void
  onClose?(): void
}

export interface RealtimeVoiceBridgeConfig {
  sessionId: string
  instructions?: string
  voice?: string
  model?: string
  workspaceId?: string
}

export interface RealtimeVoiceBridge {
  readonly outputAudioMode?: 'continuous' | 'per-response'
  connect(): Promise<void>
  sendAudio(chunk: Uint8Array): void
  sendUserMessage(text: string): void
  submitToolResult(callId: string, result: unknown): void
  handleBargeIn(): void
  close(): void
}