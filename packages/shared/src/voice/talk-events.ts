/**
 * One talk-event vocabulary shared by renderer, workspace server and native relays.
 *
 * Talk is a long-lived, bidirectional stream: a session emits turn/capture/output
 * frames, each carrying a strictly increasing `seq`. Producers (provider socket,
 * relay, renderer) may deliver frames out of order, so consumers merge through a
 * reorder buffer keyed by `seq` and never observe a non-monotonic stream.
 *
 * Provenance: OpenClaw `src/talk/talk-events.ts`, `src/talk/talk-session-controller.ts`
 * (clean-room re-expression; ledger d1.1).
 */

export const TALK_EVENT_TYPES = [
  'session.started',
  'session.ended',
  'turn.started',
  'turn.ended',
  'capture.started',
  'capture.ended',
  'input.audio.partial',
  'transcript.partial',
  'transcript.final',
  'output.text.delta',
  'output.audio.delta',
  'output.audio.done',
  'tool.call',
  'usage.metrics',
  'latency.metrics',
  'health.changed',
] as const

export type TalkEventType = (typeof TALK_EVENT_TYPES)[number]

export type TalkMode = 'realtime' | 'transcription' | 'dictation'
export type TalkTransport = 'webrtc' | 'provider-websocket' | 'gateway-relay'
export type TalkBrain = 'agent-consult' | 'direct'

export interface TalkEventScope {
  sessionId: string
  workspaceId: string
  mode: TalkMode
  transport: TalkTransport
  brain: TalkBrain
  provider: string
}

export interface TalkEvent extends TalkEventScope {
  /** Stable event identity; a retried frame keeps its id. */
  id: string
  type: TalkEventType
  /** Monotonic within one talk session, starting at 1. */
  seq: number
  timestamp: number
  final: boolean
  turnId?: string
  captureId?: string
  callId?: string
  itemId?: string
  parentId?: string
  payload: unknown
}

export interface TalkEventDraft {
  type: TalkEventType
  payload?: unknown
  final?: boolean
  turnId?: string
  captureId?: string
  callId?: string
  itemId?: string
  parentId?: string
  timestamp?: number
}

const TURN_SCOPED: Partial<Record<TalkEventType, true>> = {
  'turn.started': true,
  'turn.ended': true,
  'output.text.delta': true,
  'output.audio.delta': true,
  'output.audio.done': true,
  'tool.call': true,
  'usage.metrics': true,
  'latency.metrics': true,
}

const CAPTURE_SCOPED: Partial<Record<TalkEventType, true>> = {
  'capture.started': true,
  'capture.ended': true,
  'input.audio.partial': true,
  'transcript.partial': true,
  'transcript.final': true,
}

export function isTalkEventType(value: unknown): value is TalkEventType {
  return typeof value === 'string' && (TALK_EVENT_TYPES as readonly string[]).includes(value)
}

/**
 * Assigns a strictly increasing `seq` and stable identity to every frame of one
 * talk session. Rejects turn/capture-scoped frames that omit their owner id so a
 * consumer can always group frames by turn.
 */
export class TalkEventSequencer {
  private seq = 0
  private counter = 0
  private readonly now: () => number
  private readonly idFactory: (seq: number) => string

  constructor(
    private readonly scope: TalkEventScope,
    options: { now?: () => number; idFactory?: (seq: number) => string } = {},
  ) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? ((seq) => `${scope.sessionId}:${seq}`)
  }

  get lastSeq(): number {
    return this.seq
  }

  next(draft: TalkEventDraft): TalkEvent {
    if (!isTalkEventType(draft.type)) throw new Error('Unknown talk event type')
    if (TURN_SCOPED[draft.type] && !draft.turnId) throw new Error(`Talk event ${draft.type} requires a turnId`)
    if (CAPTURE_SCOPED[draft.type] && !draft.captureId) throw new Error(`Talk event ${draft.type} requires a captureId`)
    this.seq += 1
    this.counter += 1
    return {
      ...this.scope,
      id: this.idFactory(this.seq),
      type: draft.type,
      seq: this.seq,
      timestamp: draft.timestamp ?? this.now(),
      final: draft.final ?? false,
      ...(draft.turnId === undefined ? {} : { turnId: draft.turnId }),
      ...(draft.captureId === undefined ? {} : { captureId: draft.captureId }),
      ...(draft.callId === undefined ? {} : { callId: draft.callId }),
      ...(draft.itemId === undefined ? {} : { itemId: draft.itemId }),
      ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      payload: draft.payload ?? null,
    }
  }
}

export interface TalkEventMergeState {
  sessionId: string
  /** Highest contiguous seq already emitted to the consumer. */
  watermark: number
  /** Contiguous, monotonically ordered frames observed by the consumer. */
  ordered: TalkEvent[]
  /** Frames buffered because a lower seq has not arrived yet. */
  pending: TalkEvent[]
  /** Duplicate or already-emitted frames rejected by the buffer. */
  dropped: number
}

export function createTalkEventMergeState(sessionId: string): TalkEventMergeState {
  return { sessionId, watermark: 0, ordered: [], pending: [], dropped: 0 }
}

/**
 * Reorder buffer: accepts frames from any interleaving, buffers gaps, and emits
 * only the contiguous prefix. Duplicates and already-emitted frames are counted,
 * never appended, so `ordered` is always strictly increasing by `seq`.
 */
export function mergeTalkEvent(state: TalkEventMergeState, event: TalkEvent): TalkEventMergeState {
  if (event.sessionId !== state.sessionId) return state
  if (event.seq <= state.watermark) return { ...state, dropped: state.dropped + 1 }
  if (state.pending.some((pending) => pending.seq === event.seq)) return { ...state, dropped: state.dropped + 1 }
  const occupied = new Set(state.ordered.map((item) => item.seq))
  const pending = state.pending.filter((item) => !occupied.has(item.seq) && item.seq > state.watermark)
  pending.push(event)
  pending.sort((a, b) => a.seq - b.seq)
  const ordered = [...state.ordered]
  let watermark = state.watermark
  const stillPending: TalkEvent[] = []
  for (const item of pending) {
    if (item.seq === watermark + 1) {
      ordered.push(item)
      watermark = item.seq
    } else {
      stillPending.push(item)
    }
  }
  return { sessionId: state.sessionId, watermark, ordered, pending: stillPending, dropped: state.dropped }
}

/**
 * Turn/capture-scoped controller over one sequencer. A turn groups user/assistant
 * exchanges; a capture groups one microphone feed. Output audio can only start
 * while a turn is open, and every emitter receives monotonically ordered frames.
 */
export class TalkSessionController {
  private readonly sequencer: TalkEventSequencer
  private readonly events: TalkEvent[] = []
  private turnCounter = 0
  private captureCounter = 0
  private currentTurn: string | null = null
  private currentCapture: string | null = null

  constructor(scope: TalkEventScope, options: { now?: () => number; idFactory?: (seq: number) => string } = {}) {
    this.sequencer = new TalkEventSequencer(scope, options)
    this.emit({ type: 'session.started' })
  }

  get lastSeq(): number {
    return this.sequencer.lastSeq
  }

  get turnId(): string | null {
    return this.currentTurn
  }

  get captureId(): string | null {
    return this.currentCapture
  }

  history(): readonly TalkEvent[] {
    return this.events
  }

  emit(draft: TalkEventDraft): TalkEvent {
    const event = this.sequencer.next(draft)
    this.events.push(event)
    return event
  }

  /** Opens a turn if none is active, otherwise returns the active turn id. */
  ensureTurn(): string {
    return this.currentTurn ?? this.startTurn()
  }

  startTurn(payload: unknown = null): string {
    if (this.currentTurn) this.endTurn()
    this.turnCounter += 1
    const turnId = `turn-${this.turnCounter}`
    this.currentTurn = turnId
    this.emit({ type: 'turn.started', turnId, payload })
    return turnId
  }

  endTurn(payload: unknown = null, final = true): void {
    if (!this.currentTurn) return
    const turnId = this.currentTurn
    this.currentTurn = null
    this.emit({ type: 'turn.ended', turnId, payload, final })
  }

  cancelTurn(reason?: string): void {
    if (!this.currentTurn) return
    const turnId = this.currentTurn
    this.currentTurn = null
    this.emit({ type: 'turn.ended', turnId, payload: { cancelled: true, reason: reason ?? null }, final: true })
  }

  startCapture(payload: unknown = null): string {
    if (this.currentCapture) this.endCapture({ superseded: true })
    this.captureCounter += 1
    const captureId = `capture-${this.captureCounter}`
    this.currentCapture = captureId
    this.emit({ type: 'capture.started', captureId, payload })
    return captureId
  }

  endCapture(payload: unknown = null, final = true): void {
    if (!this.currentCapture) return
    const captureId = this.currentCapture
    this.currentCapture = null
    this.emit({ type: 'capture.ended', captureId, payload, final })
  }

  startOutputAudio(payload: unknown = null): string {
    const turnId = this.ensureTurn()
    this.lastOutputTurn = turnId
    this.emit({ type: 'output.audio.delta', turnId, payload })
    return turnId
  }

  finishOutputAudio(payload: unknown = null): void {
    const turnId = this.currentTurn ?? this.lastOutputTurn
    if (!turnId) return
    this.emit({ type: 'output.audio.done', turnId, payload, final: true })
    this.lastOutputTurn = null
  }

  private lastOutputTurn: string | null = null
}