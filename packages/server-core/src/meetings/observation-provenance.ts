/**
 * Per-line observe provenance (S6 / d2.1). `self` classifies our own speaker
 * versus a remote one; `ownEcho` is only ever set when agent audio is genuinely
 * observable (browser captions or system loopback). Mic-only capture cannot
 * hear the agent's own TTS, so it must leave `ownEcho` unset rather than claim it.
 */
import type { MeetingObservationProvenance, TranscriptSegment, TranscriptSource } from '@rox/core/meetings'

export type SelfClass = 'self' | 'other' | 'unknown'

export type ObservationProvenanceInput = {
  observer: MeetingObservationProvenance['observer']
  sessionId?: string
  observationId?: string
  epoch?: number
  observedAt?: number
  speaker?: string | null
  /** Explicit override; otherwise derived from the speaker label. */
  self?: SelfClass
  /** Diarization label that identifies our own microphone side, when known. */
  selfSpeaker?: string | null
  source: TranscriptSource
}

export function classifySelf(input: Pick<ObservationProvenanceInput, 'self' | 'speaker' | 'selfSpeaker'>): SelfClass {
  if (input.self) return input.self
  const speaker = input.speaker?.trim()
  if (!speaker) return 'unknown'
  if (input.selfSpeaker && speaker === input.selfSpeaker.trim()) return 'self'
  return 'other'
}

/**
 * `true` only when the agent's own audio is genuinely observable. A mic-only
 * path returns `undefined` (unset), never `false` — we cannot prove a negative.
 */
export function resolveOwnEcho(input: Pick<ObservationProvenanceInput, 'observer' | 'source'> & { self: SelfClass }): true | undefined {
  if (input.self !== 'self') return undefined
  if (input.observer === 'browser-caption') return true
  if (input.source === 'system') return true
  return undefined
}

export function buildObservationProvenance(input: ObservationProvenanceInput): MeetingObservationProvenance {
  const self = classifySelf(input)
  const provenance: MeetingObservationProvenance = {
    observer: input.observer,
    self,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.observationId ? { observationId: input.observationId } : {}),
    ...(input.epoch != null ? { epoch: input.epoch } : {}),
    ...(input.observedAt != null ? { observedAt: input.observedAt } : {}),
    ...(input.speaker !== undefined ? { speaker: input.speaker } : {}),
  }
  return provenance
}

export function applyObservationProvenance(
  segment: TranscriptSegment,
  input: ObservationProvenanceInput,
): TranscriptSegment {
  const provenance = buildObservationProvenance(input)
  const ownEcho = resolveOwnEcho({ observer: input.observer, source: input.source, self: provenance.self })
  return {
    ...segment,
    provenance,
    ...(ownEcho ? { ownEcho } : {}),
  }
}

export type ProvenanceLabelInput = {
  provenance?: MeetingObservationProvenance
  ownEcho?: boolean
  speakerId?: string | null
}

/** i18n key for the per-line provenance chip. */
export function provenanceLabelKey(input: ProvenanceLabelInput): string {
  if (input.ownEcho) return 'meetings.local.provenance.ownEcho'
  const observer = input.provenance?.observer
  const speaker = input.provenance?.speaker ?? input.speakerId ?? null
  if (speaker) return 'meetings.local.provenance.speaker'
  if (observer === 'browser-caption') return 'meetings.local.provenance.system'
  if (observer === 'manual') return 'meetings.local.provenance.unknown'
  if (observer === 'asr-stream') return 'meetings.local.provenance.mic'
  return 'meetings.local.provenance.unknown'
}