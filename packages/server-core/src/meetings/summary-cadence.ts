/**
 * Rolling 5-minute summary cadence (S6 / d2.5). One abortable lane per session:
 * at each window boundary the strict-JSON model step runs with a bounded budget;
 * a failure or timeout falls back to the deterministic heuristic. A summary is
 * invalidated (never silently kept) when the transcript revision advances.
 */
import { LIVE_SUMMARY_INTERVAL_MS } from '@rox/core/meetings'
import type { MeetingSessionRecord, MeetingSessionSummary } from '@rox/core/meetings'
import { isRollingSummaryStale, parseRollingSummaryJson } from '@rox/shared/meeting-agents'
import { heuristicSummary } from './summary-heuristic.ts'
import type { ObserveTranscriptLine } from './session-transcript-store.ts'

export const SUMMARY_MODEL_TIMEOUT_MS = 20_000

export type SummaryWindow = { windowStartMs: number; windowEndMs: number; index: number }

/** Windows are anchored at session start so they never drift with wall time. */
export function summaryWindow(now: number, anchor: number, intervalMs = LIVE_SUMMARY_INTERVAL_MS): SummaryWindow {
  const safeAnchor = Number.isFinite(anchor) ? anchor : 0
  const index = Math.max(0, Math.floor((now - safeAnchor) / intervalMs))
  const windowStartMs = safeAnchor + index * intervalMs
  return { windowStartMs, windowEndMs: windowStartMs + intervalMs, index }
}

export type SummaryModelArgs = {
  sessionId: string
  meetingId: string
  revision: number
  windowStartMs: number
  windowEndMs: number
  lines: readonly ObserveTranscriptLine[]
}

/** Returns the model's raw strict-JSON text; throwing/timing out triggers the fallback. */
export type SummaryModelStep = (args: SummaryModelArgs) => Promise<string>

export type SummaryCadenceInput = {
  session: Pick<MeetingSessionRecord, 'sessionId' | 'meetingId' | 'createdAt'>
  revision: number
  lines: readonly ObserveTranscriptLine[]
  now: number
  previous?: MeetingSessionSummary | null
  model?: SummaryModelStep
  modelTimeoutMs?: number
  intervalMs?: number
}

async function runModelStep(
  step: SummaryModelStep,
  args: SummaryModelArgs,
  timeoutMs: number,
): Promise<{ text: string; sourceSegmentIds: string[] } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const raw = await Promise.race([
      step(args),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('summary-model-timeout')), timeoutMs)
      }),
    ])
    return parseRollingSummaryJson(raw, args.lines.map((line) => line.key))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function runSummaryCadence(input: SummaryCadenceInput): Promise<MeetingSessionSummary> {
  const intervalMs = input.intervalMs ?? LIVE_SUMMARY_INTERVAL_MS
  const window = summaryWindow(input.now, input.session.createdAt, intervalMs)
  const previous = input.previous ?? null
  if (previous && previous.windowStartMs === window.windowStartMs) {
    if (isRollingSummaryStale(previous, input.revision)) {
      return { ...previous, invalidatedByRevision: input.revision }
    }
    return previous
  }
  const windowLines = input.lines.filter(
    (line) => line.at >= window.windowStartMs && line.at < window.windowEndMs,
  )
  if (input.model && windowLines.length > 0) {
    const payload = await runModelStep(
      input.model,
      {
        sessionId: input.session.sessionId,
        meetingId: input.session.meetingId,
        revision: input.revision,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs,
        lines: windowLines,
      },
      input.modelTimeoutMs ?? SUMMARY_MODEL_TIMEOUT_MS,
    )
    if (payload) {
      return {
        sessionId: input.session.sessionId,
        meetingId: input.session.meetingId,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs,
        revision: input.revision,
        text: payload.text,
        sourceSegmentIds: payload.sourceSegmentIds,
        generator: 'model',
        updatedAt: input.now,
      }
    }
  }
  return heuristicSummary({
    sessionId: input.session.sessionId,
    meetingId: input.session.meetingId,
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    revision: input.revision,
    lines: windowLines,
    now: input.now,
  })
}