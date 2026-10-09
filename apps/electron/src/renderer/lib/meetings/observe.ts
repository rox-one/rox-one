/**
 * Observe UI model (S6 / d2.6). Pure mapping from a transcript line's provenance
 * to the chip label key, and from a rolling summary to its block view. Kept out
 * of the component so it is testable without a DOM.
 */
import type { MeetingObservationProvenance } from '@rox/core/meetings'
import type { LocalTranscriptSegment } from '../../../shared/meetings-local'

export type ObserveChipInput = Pick<LocalTranscriptSegment, 'ownEcho' | 'speakerId' | 'provenance'>

export type ObserveChip = {
  labelKey: string
  ownEcho: boolean
  speaker: string | null
  /** False for legacy segments with no provenance to show. */
  present: boolean
}

export function observeChip(input: ObserveChipInput): ObserveChip {
  const ownEcho = input.ownEcho === true
  const speaker = input.provenance?.speaker ?? input.speakerId ?? null
  return {
    labelKey: chipLabelKey(input.provenance, ownEcho, speaker),
    ownEcho,
    speaker,
    present: ownEcho || speaker != null || input.provenance != null,
  }
}

function chipLabelKey(provenance: MeetingObservationProvenance | undefined, ownEcho: boolean, speaker: string | null): string {
  if (ownEcho) return 'meetings.local.provenance.ownEcho'
  if (speaker) return 'meetings.local.provenance.speaker'
  if (provenance?.observer === 'browser-caption') return 'meetings.local.provenance.system'
  if (provenance?.observer === 'asr-stream') return 'meetings.local.provenance.mic'
  return 'meetings.local.provenance.unknown'
}

export type RollingSummaryInput = {
  text: string
  updatedAt: number
  generator?: 'model' | 'heuristic'
}

export type RollingSummaryView = {
  text: string
  updatedAt: number
  generatorKey: string
  stale: boolean
}

export function rollingSummaryView(
  summary: RollingSummaryInput | null,
  transcriptRevision?: number,
  summaryRevision?: number,
): RollingSummaryView | null {
  if (!summary || !summary.text.trim()) return null
  return {
    text: summary.text,
    updatedAt: summary.updatedAt,
    generatorKey: summary.generator === 'model' ? 'meetings.local.summary.model' : 'meetings.local.summary.heuristic',
    stale: transcriptRevision != null && summaryRevision != null && summaryRevision < transcriptRevision,
  }
}