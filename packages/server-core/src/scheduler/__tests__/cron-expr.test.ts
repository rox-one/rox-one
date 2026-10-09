import { describe, expect, it } from 'bun:test'
import {
  CronExpressionError,
  parseCronExpression,
} from '../cron-expr.ts'

const MINUTE = 60_000
/** 2026-01-01T00:00:00Z — a UTC minute boundary on a Thursday. */
const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0)

function expectCronError(expression: string, code: CronExpressionError['code']): void {
  try {
    parseCronExpression(expression)
    throw new Error(`expected "${expression}" to be rejected`)
  } catch (error) {
    expect(error).toBeInstanceOf(CronExpressionError)
    expect((error as CronExpressionError).code).toBe(code)
  }
}

describe('cron expression parsing', () => {
  it('rejects the wrong number of fields with a typed error', () => {
    expectCronError('* * *', 'INVALID_FIELD_COUNT')
    expectCronError('* * * * * *', 'INVALID_FIELD_COUNT')
    expectCronError('@hourly', 'INVALID_FIELD_COUNT')
    expectCronError('   ', 'INVALID_FIELD_COUNT')
  })

  it('rejects out-of-range values and non-positive steps', () => {
    expectCronError('60 * * * *', 'OUT_OF_RANGE')
    expectCronError('* 24 * * *', 'OUT_OF_RANGE')
    expectCronError('* * 0 * *', 'OUT_OF_RANGE')
    expectCronError('* * * 13 *', 'OUT_OF_RANGE')
    expectCronError('* * * * 8', 'OUT_OF_RANGE')
    expectCronError('*/0 * * * *', 'OUT_OF_RANGE')
  })

  it('rejects unsupported syntax rather than accepting it partially', () => {
    expectCronError('* * * * SUN', 'INVALID_FIELD_SYNTAX')
    expectCronError('* * * JAN *', 'INVALID_FIELD_SYNTAX')
    expectCronError('? * * * *', 'INVALID_FIELD_SYNTAX')
    expectCronError('* * L * *', 'INVALID_FIELD_SYNTAX')
    expectCronError('* * * * 1#2', 'INVALID_FIELD_SYNTAX')
    expectCronError('5, * * * *', 'INVALID_FIELD_SYNTAX')
    expectCronError('10-5 * * * *', 'INVALID_FIELD_SYNTAX')
    expectCronError('*/ * * * *', 'INVALID_FIELD_SYNTAX')
  })

  it('advances to the next stepped minute', () => {
    const expr = parseCronExpression('*/15 * * * *')
    expect(expr.nextAfter(EPOCH)).toBe(EPOCH + 15 * MINUTE)
    expect(expr.nextAfter(EPOCH + 15 * MINUTE)).toBe(EPOCH + 30 * MINUTE)
  })

  it('treats 0 and 7 as Sunday and matches with the standard day semantics', () => {
    // 2026-01-04 is a Sunday.
    const sundayMidnightUtc = Date.UTC(2026, 0, 4, 0, 0, 0)
    const withZero = parseCronExpression('0 0 * * 0')
    const withSeven = parseCronExpression('0 0 * * 7')
    expect(withZero.nextAfter(EPOCH)).toBe(sundayMidnightUtc)
    expect(withSeven.nextAfter(EPOCH)).toBe(sundayMidnightUtc)

    // day-of-month AND day-of-week both restricted => either matches.
    const either = parseCronExpression('0 0 15 * 1')
    // 2026-01-05 is the first Monday after the epoch.
    expect(either.nextAfter(EPOCH)).toBe(Date.UTC(2026, 0, 5, 0, 0, 0))
  })

  it('finds infrequent matches such as Feb 29 without scanning minute-by-minute forever', () => {
    const leapDay = parseCronExpression('0 0 29 2 *')
    // Next Feb 29 after 2026-01-01 is 2028-02-29.
    expect(leapDay.nextAfter(EPOCH)).toBe(Date.UTC(2028, 1, 29, 0, 0, 0))
  })

  it('raises a typed NO_MATCH when a schedule can never fire', () => {
    expectCronError('0 0 30 2 *', 'NO_MATCH')
  })
})