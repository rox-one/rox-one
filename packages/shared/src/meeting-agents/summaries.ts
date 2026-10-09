/**
 * Rolling 5-minute summary lane (S6 / d2.5). The model step is strict JSON and
 * its citations are validated against the window's transcript keys; when it
 * fails the deterministic heuristic in server-core takes over. This module is
 * pure so both the server lane and the renderer agree on staleness and parsing.
 */
import type { MeetingSessionSummary } from '@rox/core/meetings'
import { LIVE_SUMMARY_INTERVAL_MS } from '@rox/core/meetings'
import { planMeetingActions, type MeetingActionPlan } from './planning.ts'

export const ROLLING_SUMMARY_SCHEMA = 'meeting.rolling-summary.v1'

export type RollingSummaryPayload = {
  text: string
  sourceSegmentIds: string[]
}

/**
 * Strict JSON: an object with a non-empty `text` and at least one citation that
 * exists in the window. Anything else is rejected so the caller falls back.
 */
export function parseRollingSummaryJson(raw: string, allowedSegmentIds: readonly string[]): RollingSummaryPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  if (!text) return null
  if (!Array.isArray(record.sourceSegmentIds)) return null
  const allowed = new Set(allowedSegmentIds)
  const sourceSegmentIds = [...new Set(record.sourceSegmentIds.filter(
    (id): id is string => typeof id === 'string' && allowed.has(id),
  ))]
  if (sourceSegmentIds.length === 0) return null
  return { text, sourceSegmentIds }
}

/** A summary is stale once the transcript revision it was built from advances. */
export function isRollingSummaryStale(
  summary: Pick<MeetingSessionSummary, 'revision'>,
  transcriptRevision: number,
): boolean {
  return summary.revision < transcriptRevision
}

export type RollingSummaryLanePlan = {
  meetingId: string
  windowStartMs: number
  windowEndMs: number
  intervalMs: number
  schemaId: string
  plan: MeetingActionPlan
}

/** Bind the summary lane to the existing recipe→job planner, not a new planner. */
export function planRollingSummaryLane(input: {
  meetingId: string
  sourceRevision: number
  windowStartMs: number
  windowEndMs: number
  recipeId?: MeetingActionPlan['recipeId']
  slash?: string
  now?: number
}): RollingSummaryLanePlan {
  const plan = planMeetingActions(
    { meetingId: input.meetingId, recipeId: input.recipeId, slash: input.slash },
    input.sourceRevision,
    input.now,
  )
  return {
    meetingId: input.meetingId,
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    intervalMs: LIVE_SUMMARY_INTERVAL_MS,
    schemaId: ROLLING_SUMMARY_SCHEMA,
    plan,
  }
}