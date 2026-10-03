import type { LocalMeeting, LocalMeetingExtractionResult, LocalTranscript, MeetingsLocalResult } from '../../shared/meetings-local'

export const EXTRACTION_START_TIMEOUT_MS = 120_000
export const EXTRACTION_RUN_TIMEOUT_MS = 10 * 60_000

/** No trust in renderer-produced JSON: all provenance is checked against disk. */
export function applyExtractionResult(meeting: LocalMeeting, transcript: LocalTranscript, runId: string, result: LocalMeetingExtractionResult, now: number): MeetingsLocalResult<LocalMeeting> {
  const run = meeting.extraction
  if (!run || run.id !== runId || run.status !== 'running') return { ok: false, code: 'extraction-conflict' }
  if (meeting.workspaceId !== run.workspaceId || transcript.revision !== run.transcriptRevision || meeting.transcript.revision !== run.transcriptRevision || (meeting.analysisEditRevision ?? 0) !== run.editRevision || meeting.transcript.status !== 'done') {
    return { ok: false, code: 'extraction-stale' }
  }
  if (!result || typeof result.summary !== 'string' || !Array.isArray(result.summarySourceSegmentIds) || !Array.isArray(result.actions) || !Array.isArray(result.decisions) || !Array.isArray(result.questions)) {
    return { ok: false, code: 'extraction-invalid' }
  }
  const allowed = new Set(transcript.segments.map((segment) => segment.id))
  const citations = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && allowed.has(id)))] : []
  const text = (value: unknown, max = 10_000): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const known = new Set(meeting.actions.map((action) => action.text.trim().toLocaleLowerCase()))
  const actions = result.actions.slice(0, 30).flatMap((action, index) => {
    const title = text(action?.text)
    const ids = citations(action?.sourceSegmentIds)
    const key = title.toLocaleLowerCase()
    if (!title || !ids.length || known.has(key)) return []
    known.add(key)
    return [{ id: `${run.id}-action-${index}`, text: title, done: false, generated: true, sourceSegmentIds: ids, sourceTranscriptRevision: transcript.revision, createdAt: now }]
  })
  const extractedDecisions = result.decisions.slice(0, 20).flatMap((decision, index) => {
    const title = text(decision?.title)
    const ids = citations(decision?.sourceSegmentIds)
    if (!title || !ids.length) return []
    return [{ id: `${run.id}-decision-${index}`, title, why: text(decision.why), who: Array.isArray(decision.who) ? decision.who.flatMap((name) => text(name, 200) ? [text(name, 200)] : []).slice(0, 100) : [], sourceSegmentIds: ids, sourceTranscriptRevision: transcript.revision, sourceStartMs: transcript.segments.find((segment) => segment.id === ids[0])?.startMs }]
  })
  const questions = result.questions.slice(0, 30).flatMap((question, index) => {
    const value = text(question?.text)
    const ids = citations(question?.sourceSegmentIds)
    return value && ids.length ? [{ id: `${run.id}-question-${index}`, text: value, sourceSegmentIds: ids, createdAt: now }] : []
  })
  const summaryIds = citations(result.summarySourceSegmentIds)
  // A manually written summary stays in place when a new transcript is analysed.
  const summary = text(result.summary, 100_000) && summaryIds.length && !(run.automatic && meeting.summary?.generated === false)
    ? { text: text(result.summary, 100_000), generated: true, sessionId: run.sessionId, sourceSegmentIds: summaryIds, sourceTranscriptRevision: transcript.revision, questions, updatedAt: now }
    : meeting.summary
  return { ok: true, value: { ...meeting, summary, actions: [...meeting.actions, ...actions], extractedDecisions,
    summaryRun: undefined, extraction: { ...run, status: 'done', finishedAt: now, errorCode: undefined }, updatedAt: now } }
}
