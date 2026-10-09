/**
 * Bounded observe transcript store (S6 / d2.3). Caps: 2000 lines per session,
 * a 64-key tail cursor for replay dedupe, and at most 4 retained ended
 * transcripts. Evictions are surfaced as a signal, never silently dropped.
 */
import {
  ENDED_TRANSCRIPTS_MAX,
  TRANSCRIPT_CURSOR_TAIL,
  TRANSCRIPT_MAX_LINES,
} from '@rox/core/meetings'

export type ObserveTranscriptLine = {
  seq: number
  key: string
  sessionId: string
  speaker: string
  text: string
  at: number
  final: boolean
  ownEcho?: boolean
}

export type TranscriptEviction = {
  sessionId: string
  reason: 'line-cap' | 'ended-cap'
  evictedKeys: readonly string[]
}

export type AppendResult =
  | { accepted: true; line: ObserveTranscriptLine; duplicate: false }
  | { accepted: false; duplicate: true }
  | { accepted: false; duplicate: false; code: 'session-ended' }

export type AppendInput = {
  key: string
  speaker?: string | null
  text: string
  at: number
  final?: boolean
  ownEcho?: boolean
}

type SessionBuffer = {
  lines: ObserveTranscriptLine[]
  cursor: string[]
  nextSeq: number
  ended: boolean
  evicted: boolean
  endedOrder: number
}

export class MeetingTranscriptStore {
  private readonly buffers = new Map<string, SessionBuffer>()
  private readonly pendingEvictions: TranscriptEviction[] = []
  private endedSeq = 0

  constructor(private readonly caps: {
    maxLines?: number
    cursorTail?: number
    endedMax?: number
  } = {}) {}

  private buffer(sessionId: string): SessionBuffer {
    const existing = this.buffers.get(sessionId)
    if (existing) return existing
    const created: SessionBuffer = { lines: [], cursor: [], nextSeq: 0, ended: false, evicted: false, endedOrder: 0 }
    this.buffers.set(sessionId, created)
    return created
  }

  hasSeen(sessionId: string, key: string): boolean {
    return this.buffer(sessionId).cursor.includes(key)
  }

  /** Last `caps.cursorTail` keys, newest last — the replay dedupe cursor. */
  tailKeys(sessionId: string): string[] {
    return [...this.buffer(sessionId).cursor]
  }

  lineCount(sessionId: string): number {
    return this.buffer(sessionId).lines.length
  }

  isEvicted(sessionId: string): boolean {
    return this.buffer(sessionId).evicted
  }

  isEnded(sessionId: string): boolean {
    return this.buffer(sessionId).ended
  }

  append(sessionId: string, input: AppendInput): AppendResult {
    const buffer = this.buffer(sessionId)
    if (buffer.ended) return { accepted: false, duplicate: false, code: 'session-ended' }
    if (buffer.cursor.includes(input.key)) return { accepted: false, duplicate: true }
    const line: ObserveTranscriptLine = {
      seq: buffer.nextSeq,
      key: input.key,
      sessionId,
      speaker: input.speaker?.trim() || '',
      text: input.text,
      at: input.at,
      final: input.final ?? true,
      ...(input.ownEcho ? { ownEcho: true } : {}),
    }
    buffer.nextSeq += 1
    buffer.lines.push(line)
    buffer.cursor.push(input.key)
    const cursorTail = this.caps.cursorTail ?? TRANSCRIPT_CURSOR_TAIL
    if (buffer.cursor.length > cursorTail) {
      buffer.cursor.splice(0, buffer.cursor.length - cursorTail)
      buffer.evicted = true
    }
    const maxLines = this.caps.maxLines ?? TRANSCRIPT_MAX_LINES
    if (buffer.lines.length > maxLines) {
      const overflow = buffer.lines.splice(0, buffer.lines.length - maxLines)
      buffer.evicted = true
      this.pendingEvictions.push({ sessionId, reason: 'line-cap', evictedKeys: overflow.map((line) => line.key) })
    }
    return { accepted: true, line, duplicate: false }
  }

  lines(sessionId: string, afterSeq?: number): ObserveTranscriptLine[] {
    const all = this.buffer(sessionId).lines
    if (afterSeq == null) return [...all]
    return all.filter((line) => line.seq > afterSeq)
  }

  markEnded(sessionId: string): void {
    const buffer = this.buffer(sessionId)
    if (buffer.ended) return
    buffer.ended = true
    this.endedSeq += 1
    buffer.endedOrder = this.endedSeq
    const endedMax = this.caps.endedMax ?? ENDED_TRANSCRIPTS_MAX
    const ended = [...this.buffers.entries()]
      .filter(([, value]) => value.ended)
      .sort(([, a], [, b]) => a.endedOrder - b.endedOrder)
    while (ended.length > endedMax) {
      const [oldestId, oldest] = ended.shift()!
      this.buffers.delete(oldestId)
      this.pendingEvictions.push({
        sessionId: oldestId,
        reason: 'ended-cap',
        evictedKeys: oldest.lines.map((line) => line.key),
      })
    }
  }

  /** Pull the eviction signal accumulated since the last drain. */
  drainEvictions(): TranscriptEviction[] {
    return this.pendingEvictions.splice(0, this.pendingEvictions.length)
  }

  clear(sessionId: string): void {
    this.buffers.delete(sessionId)
  }
}