/**
 * Deterministic rolling-summary fallback (S6 / d2.5). When the model step fails
 * or times out we still owe the user a summary, so decisions, action items and
 * risks are extracted with the same RU-first regex pattern as the meeting
 * extraction seed. Output is transcript-backed: every item cites its line key.
 */
import type { MeetingSessionSummary } from '@rox/core/meetings'
import type { ObserveTranscriptLine } from './session-transcript-store.ts'

export type HeuristicNoteKind = 'decision' | 'action' | 'risk'

export type HeuristicNote = {
  kind: HeuristicNoteKind
  text: string
  sourceSegmentIds: string[]
}

const PATTERNS: Record<HeuristicNoteKind, RegExp> = {
  decision: /(решил|решени|договорил|постановил|согласовал|decid|decision|agreed|approv)/iu,
  action: /(надо|нужно|сдела[йт]|подготов|отправ|провер|напиш|созда|создай|запланиру|follow[- ]?up|action item|todo|will send|take away)/iu,
  risk: /(риск|проблем|блокер|блокиру|опасн|не удастся|risk|blocker|concern|at risk)/iu,
}

const KIND_ORDER: readonly HeuristicNoteKind[] = ['risk', 'decision', 'action']

export function extractHeuristicNotes(lines: readonly ObserveTranscriptLine[]): HeuristicNote[] {
  const notes: HeuristicNote[] = []
  for (const kind of KIND_ORDER) {
    const pattern = PATTERNS[kind]
    for (const line of lines) {
      const text = line.text.trim()
      if (!text || !pattern.test(text)) continue
      notes.push({ kind, text, sourceSegmentIds: [line.key] })
    }
  }
  return notes
}

export function heuristicSummary(input: {
  sessionId: string
  meetingId: string
  windowStartMs: number
  windowEndMs: number
  revision: number
  lines: readonly ObserveTranscriptLine[]
  now: number
}): MeetingSessionSummary {
  const notes = extractHeuristicNotes(input.lines)
  const sourceSegmentIds = [...new Set(notes.flatMap((note) => note.sourceSegmentIds))]
  return {
    sessionId: input.sessionId,
    meetingId: input.meetingId,
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    revision: input.revision,
    text: notes.map((note) => note.text).join(' • '),
    sourceSegmentIds,
    generator: 'heuristic',
    updatedAt: input.now,
  }
}