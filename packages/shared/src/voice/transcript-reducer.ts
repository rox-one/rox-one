/**
 * Pure transcript reducer (issue #362).
 * Key is streamId+segmentId. Older/replayed packets never overwrite a newer revision.
 * Manual corrections live on a separate revision; Person binding is not a speaker label.
 */

export type TranscriptSegmentPatch = {
  meetingId: string
  streamId: string
  id: string
  revision: number
  sequence: number
  startMs: number
  endMs: number
  source: 'microphone' | 'system' | 'import' | 'room'
  speakerId: string | null
  language: string | null
  text: string
  final: boolean
  kind?: 'asr' | 'manual'
  modelRevision?: string
  supersedesRevision?: number
}

export type SpeakerBinding = {
  speakerId: string
  personId?: string
  status: 'unresolved' | 'bound' | 'ambiguous'
}

export type TranscriptState = {
  segments: Record<string, TranscriptSegmentPatch>
  speakers: Record<string, SpeakerBinding>
  finalizedWatermark: number
}

export function emptyTranscriptState(): TranscriptState {
  return { segments: {}, speakers: {}, finalizedWatermark: 0 }
}

export function segmentKey(segment: Pick<TranscriptSegmentPatch, 'streamId' | 'id'>): string {
  return `${segment.streamId}:${segment.id}`
}

export function applyTranscriptPatch(state: TranscriptState, segment: TranscriptSegmentPatch): TranscriptState {
  const key = segmentKey(segment)
  const current = state.segments[key]
  const segments = { ...state.segments }
  const ignoreOlder = current && segment.revision < current.revision
  const ignoreReplay = current && segment.revision === current.revision && segment.kind !== 'manual'
  if (ignoreOlder || ignoreReplay) {
    return {
      segments: { ...state.segments },
      speakers: { ...state.speakers },
      finalizedWatermark: state.finalizedWatermark,
    }
  }
  segments[key] = { ...segment }
  const speakers = { ...state.speakers }
  if (segment.speakerId) {
    speakers[segment.speakerId] ??= { speakerId: segment.speakerId, status: 'unresolved' }
  }
  let watermark = state.finalizedWatermark
  if (segment.final && segment.sequence > watermark) watermark = segment.sequence
  return { segments, speakers, finalizedWatermark: watermark }
}

export function bindSpeaker(
  state: TranscriptState,
  speakerId: string,
  personIds: readonly string[],
): TranscriptState {
  const speakers = { ...state.speakers }
  if (personIds.length === 1) {
    speakers[speakerId] = { speakerId, personId: personIds[0], status: 'bound' }
  } else if (personIds.length === 0) {
    speakers[speakerId] = { speakerId, status: 'unresolved' }
  } else {
    speakers[speakerId] = { speakerId, status: 'ambiguous' }
  }
  return { ...state, speakers }
}

export function coverageGaps(state: TranscriptState): { missing: boolean; finalizedWatermark: number; count: number } {
  return {
    missing: Object.keys(state.segments).length === 0,
    finalizedWatermark: state.finalizedWatermark,
    count: Object.keys(state.segments).length,
  }
}
