import type { TranscriptSegment } from '@craft-agent/core/meetings'
import { segmentKey } from '@craft-agent/core/meetings'

export type TranscriptState = {
  segments: Record<string, TranscriptSegment>
  finalizedWatermark: number
}

export function emptyTranscriptState(): TranscriptState {
  return { segments: {}, finalizedWatermark: 0 }
}

/** Pure reducer. Key is streamId+segmentId. Older/replayed revisions do not clobber a newer correction. */
export function applyTranscriptPatch(state: TranscriptState, segment: TranscriptSegment): TranscriptState {
  const key = segmentKey(segment)
  const current = state.segments[key]
  if (current && current.revision > segment.revision) return state
  if (current && current.revision === segment.revision && current.text === segment.text && current.final === segment.final) {
    return state
  }
  const next = {
    ...state,
    segments: { ...state.segments, [key]: { ...segment } },
    finalizedWatermark: segment.final
      ? Math.max(state.finalizedWatermark, segment.revision)
      : state.finalizedWatermark,
  }
  return next
}
