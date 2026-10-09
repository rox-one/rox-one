/**
 * W1-12 (#1509) — `rule_execution` lifecycle: resume point, status derivation
 * and the backoff schedule (DATA-MODEL §5.16).
 */
import { describe, expect, test } from 'bun:test'
import {
  MAX_RULE_ATTEMPTS,
  RULE_BACKOFF_SCHEDULE_MS,
  executionStatusAfterAttempt,
  isStepDone,
  mergeStepRecords,
  needsRetry,
  resumeStepIndex,
  ruleRetryDelayMs,
  skipMarker,
  skipReasonFromMarker,
  type RuleStepRecord,
} from '../execution'

const pending = (action: string): RuleStepRecord => ({ action, command_id: `k:${action}`, status: 'pending' })
const done = (action: string): RuleStepRecord => ({ action, command_id: `k:${action}`, status: 'succeeded' })
const failed = (action: string): RuleStepRecord => ({ action, command_id: `k:${action}`, status: 'failed', error: 'NO' })
const skipped = (action: string): RuleStepRecord => ({ action, command_id: `k:${action}`, status: 'skipped' })

describe('backoff schedule', () => {
  test('1 min, 5 min, 30 min, 2 h; then the budget is spent', () => {
    expect(RULE_BACKOFF_SCHEDULE_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000])
    expect(ruleRetryDelayMs(1)).toBe(60_000)
    expect(ruleRetryDelayMs(2)).toBe(300_000)
    expect(ruleRetryDelayMs(3)).toBe(1_800_000)
    expect(ruleRetryDelayMs(4)).toBe(7_200_000)
    expect(ruleRetryDelayMs(5)).toBeNull()
    expect(ruleRetryDelayMs(0)).toBeNull()
    expect(MAX_RULE_ATTEMPTS).toBe(4)
  })
})

describe('resume point', () => {
  test('starts at 0 for a fresh execution', () => {
    expect(resumeStepIndex(['a', 'b', 'c'], [])).toBe(0)
  })

  test('resumes from the first non-succeeded step (steps already done are never repeated)', () => {
    expect(resumeStepIndex(['a', 'b', 'c'], [done('a'), failed('b')])).toBe(1)
    expect(resumeStepIndex(['a', 'b', 'c'], [done('a'), failed('b'), failed('c')])).toBe(1)
    expect(resumeStepIndex(['a', 'b', 'c'], [failed('a'), done('b')])).toBe(0)
  })

  test('an optional step skipped by policy counts as done', () => {
    expect(resumeStepIndex(['a', 'b', 'c'], [done('a'), skipped('b')])).toBe(2)
    expect(isStepDone(skipped('b'))).toBe(true)
    expect(isStepDone(pending('b'))).toBe(false)
  })

  test('a fully succeeded execution is complete', () => {
    expect(resumeStepIndex(['a', 'b'], [done('a'), done('b')])).toBe(2)
  })
})

describe('status derivation', () => {
  const base = { stepNames: ['a', 'b', 'c'], optional: new Set(['c']) }

  test('succeeded when every step is done', () => {
    expect(executionStatusAfterAttempt({ ...base, records: [done('a'), done('b'), done('c')], attempts: 1 })).toBe('succeeded')
  })

  test('partially_succeeded when only optional steps failed', () => {
    expect(executionStatusAfterAttempt({ ...base, records: [done('a'), done('b'), failed('c')], attempts: 1 })).toBe('partially_succeeded')
  })

  test('running while a required step failed and attempts remain', () => {
    expect(executionStatusAfterAttempt({ ...base, records: [done('a'), failed('b')], attempts: 1 })).toBe('running')
    expect(needsRetry({ ...base, records: [done('a'), failed('b')], attempts: 3 })).toBe(true)
  })

  test('failed once the attempt budget is spent', () => {
    expect(executionStatusAfterAttempt({ ...base, records: [done('a'), failed('b')], attempts: MAX_RULE_ATTEMPTS })).toBe('failed')
    expect(needsRetry({ ...base, records: [done('a'), failed('b')], attempts: MAX_RULE_ATTEMPTS })).toBe(false)
  })
})

describe('step records', () => {
  test('merge keeps the planned command and counts attempts per step', () => {
    const planned = [pending('a'), pending('b')]
    const first = mergeStepRecords(planned, [
      { action: 'a', commandId: 'k:a', status: 'succeeded', receiptStatus: 'applied', receiptRef: 'task:1', durationMs: 3, finishedAt: 'T1' },
      { action: 'b', commandId: 'k:b', status: 'failed', error: 'INTERNAL', finishedAt: 'T1' },
    ])
    expect(first[0]).toEqual({ action: 'a', command_id: 'k:a', status: 'succeeded', receipt_status: 'applied', receipt_ref: 'task:1', attempts: 1, duration_ms: 3, finished_at: 'T1' })
    expect(first[1]!.attempts).toBe(1)

    const second = mergeStepRecords(first, [
      { action: 'b', commandId: 'k:b', status: 'succeeded', receiptStatus: 'duplicate', finishedAt: 'T2' },
    ])
    expect(second[1]).toMatchObject({ action: 'b', status: 'succeeded', receipt_status: 'duplicate', attempts: 2 })
    expect(resumeStepIndex(['a', 'b'], second)).toBe(2)
  })

  test('the skip marker round-trips the reason', () => {
    expect(skipMarker('all_day')).toBe('skipped:all_day')
    expect(skipReasonFromMarker(skipMarker('free'))).toBe('free')
    expect(skipReasonFromMarker(undefined)).toBeUndefined()
    expect(skipReasonFromMarker('handler failed')).toBeUndefined()
  })
})