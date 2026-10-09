import { describe, expect, test } from 'bun:test'
import {
  ROLLING_SUMMARY_SCHEMA,
  isRollingSummaryStale,
  parseRollingSummaryJson,
  planRollingSummaryLane,
} from '../summaries.ts'
import { LIVE_SUMMARY_INTERVAL_MS } from '@rox/core/meetings'

describe('rolling summary lane (d2.5)', () => {
  test('strict JSON keeps only allowed citations', () => {
    expect(parseRollingSummaryJson(
      JSON.stringify({ text: 'итог', sourceSegmentIds: ['k0', 'outside', 'k1'] }),
      ['k0', 'k1'],
    )).toEqual({ text: 'итог', sourceSegmentIds: ['k0', 'k1'] })
  })

  test('rejects malformed, uncited or non-JSON payloads', () => {
    expect(parseRollingSummaryJson('not json', ['k0'])).toBeNull()
    expect(parseRollingSummaryJson(JSON.stringify({ text: '', sourceSegmentIds: ['k0'] }), ['k0'])).toBeNull()
    expect(parseRollingSummaryJson(JSON.stringify({ text: 'итог', sourceSegmentIds: ['missing'] }), ['k0'])).toBeNull()
    expect(parseRollingSummaryJson(JSON.stringify({ text: 'итог' }), ['k0'])).toBeNull()
    expect(parseRollingSummaryJson(JSON.stringify(['k0']), ['k0'])).toBeNull()
  })

  test('staleness tracks the transcript revision', () => {
    expect(isRollingSummaryStale({ revision: 1 }, 2)).toBe(true)
    expect(isRollingSummaryStale({ revision: 2 }, 2)).toBe(false)
    expect(isRollingSummaryStale({ revision: 3 }, 1)).toBe(false)
  })

  test('lane plan reuses the recipe planner, not a new one', () => {
    const lane = planRollingSummaryLane({
      meetingId: 'm1',
      sourceRevision: 4,
      windowStartMs: 0,
      windowEndMs: LIVE_SUMMARY_INTERVAL_MS,
      recipeId: 'design-review',
      now: 0,
    })
    expect(lane.schemaId).toBe(ROLLING_SUMMARY_SCHEMA)
    expect(lane.intervalMs).toBe(LIVE_SUMMARY_INTERVAL_MS)
    expect(lane.plan.recipeId).toBe('design-review')
    expect(lane.plan.sourceRevision).toBe(4)
    expect(lane.plan.playbook).toBeTruthy()
  })

  test('unknown slash fails closed instead of silently binding a lane', () => {
    expect(() => planRollingSummaryLane({
      meetingId: 'm1',
      sourceRevision: 0,
      windowStartMs: 0,
      windowEndMs: LIVE_SUMMARY_INTERVAL_MS,
      slash: '/nope',
      now: 0,
    })).toThrow()
  })
})