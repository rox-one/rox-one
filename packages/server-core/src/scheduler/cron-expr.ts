/**
 * Minimal 5-field cron expression parser (minute resolution, UTC).
 *
 * Clean-room re-expression of the scheduling semantics described for the
 * OpenClaw gateway cron surface (port row f.8; upstream `src/cron` and
 * `src/infra/gateway-scheduler.ts`). We deliberately support only a documented
 * subset and reject everything else loudly instead of silently accepting a
 * partially-understood schedule.
 *
 * Supported grammar, five whitespace-separated fields evaluated in **UTC**:
 *
 *     minute hour day-of-month month day-of-week
 *
 *   - `*`                    every value in range
 *   - `a`                    a single value
 *   - `a-b`                  an inclusive range
 *   - `*` and `star/step`   stepping (step is a positive integer)
 *   - `a,b,c`                a comma list of the forms above
 *
 * Ranges: minute 0-59, hour 0-23, day-of-month 1-31, month 1-12,
 * day-of-week 0-6 where 0 is Sunday (7 is accepted as a Sunday alias).
 *
 * day-of-month / day-of-week follow standard cron: when both fields are
 * restricted a day matches if *either* matches; when either is `*` only the
 * other field constrains the day.
 *
 * Rejected (throws `CronExpressionError`): second-resolution or otherwise
 * non-5-field input, names (`SUN`, `JAN`), special tokens (`?`, `L`, `W`, `#`),
 * `@macros`, empty list elements, out-of-range values and non-positive steps.
 * There is no external dependency and no TZ database; a year with no matching
 * instant (e.g. `0 0 30 2 *`) raises `NO_MATCH`.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Search horizon for the next matching instant (covers Feb-29 leaps). */
const MAX_SEARCH_MS = 5 * 366 * DAY_MS

export type CronErrorCode =
  | 'INVALID_FIELD_COUNT'
  | 'INVALID_FIELD_SYNTAX'
  | 'OUT_OF_RANGE'
  | 'NO_MATCH'

export type CronFieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

/** Typed, controlled error for an unparseable or unsatisfiable cron expression. */
export class CronExpressionError extends Error {
  readonly code: CronErrorCode
  readonly field?: CronFieldName

  constructor(code: CronErrorCode, message: string, field?: CronFieldName) {
    super(message)
    this.name = 'CronExpressionError'
    this.code = code
    this.field = field
  }
}

interface ParsedField {
  readonly values: Set<number>
  readonly wildcard: boolean
}

interface FieldDefinition {
  readonly name: CronFieldName
  readonly min: number
  readonly max: number
  /** Collapse an accepted alias onto its canonical value (dow 7 -> 0). */
  readonly normalize?: (value: number) => number
}

const FIELDS: readonly FieldDefinition[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 7, normalize: (value) => (value === 7 ? 0 : value) },
]

function fail(code: CronErrorCode, message: string, field?: CronFieldName): never {
  throw new CronExpressionError(code, message, field)
}

function parseInteger(token: string, field: CronFieldName): number {
  if (!/^\d+$/.test(token)) {
    fail('INVALID_FIELD_SYNTAX', `cron ${field}: "${token}" is not an integer`, field)
  }
  return Number.parseInt(token, 10)
}

function parseToken(token: string, def: FieldDefinition): { from: number; to: number; step: number } {
  const slash = token.indexOf('/')
  if (slash !== -1 && token.indexOf('/', slash + 1) !== -1) {
    fail('INVALID_FIELD_SYNTAX', `cron ${def.name}: "${token}" has multiple step separators`, def.name)
  }
  const rangePart = slash === -1 ? token : token.slice(0, slash)
  let step = 1
  if (slash !== -1) {
    const stepToken = token.slice(slash + 1)
    if (stepToken === '') {
      fail('INVALID_FIELD_SYNTAX', `cron ${def.name}: "${token}" is missing a step`, def.name)
    }
    step = parseInteger(stepToken, def.name)
    if (step < 1) {
      fail('OUT_OF_RANGE', `cron ${def.name}: step must be >= 1, got ${step}`, def.name)
    }
  }

  let from: number
  let to: number
  if (rangePart === '*') {
    from = def.min
    to = def.max
  } else if (rangePart.includes('-')) {
    const [fromToken, toToken, ...rest] = rangePart.split('-')
    if (rest.length > 0 || fromToken === '' || toToken === '') {
      fail('INVALID_FIELD_SYNTAX', `cron ${def.name}: "${token}" is not a valid range`, def.name)
    }
    from = parseInteger(fromToken!, def.name)
    to = parseInteger(toToken!, def.name)
    if (from < def.min || from > def.max || to < def.min || to > def.max) {
      fail('OUT_OF_RANGE', `cron ${def.name}: range "${rangePart}" is outside ${def.min}-${def.max}`, def.name)
    }
    if (from > to) {
      // `from > to` describes a wrapping range we do not define for this subset.
      fail('INVALID_FIELD_SYNTAX', `cron ${def.name}: range "${rangePart}" is descending`, def.name)
    }
  } else {
    from = parseInteger(rangePart, def.name)
    to = from
    if (from < def.min || from > def.max) {
      fail('OUT_OF_RANGE', `cron ${def.name}: value ${from} is outside ${def.min}-${def.max}`, def.name)
    }
  }

  return { from, to, step }
}

function parseField(raw: string, def: FieldDefinition): ParsedField {
  const values = new Set<number>()
  const wildcard = raw.trim() === '*'
  const elements = raw.split(',')
  for (const element of elements) {
    if (element === '') {
      fail('INVALID_FIELD_SYNTAX', `cron ${def.name}: empty list element`, def.name)
    }
    const { from, to, step } = parseToken(element, def)
    for (let value = from; value <= to; value += step) {
      values.add(def.normalize ? def.normalize(value) : value)
    }
  }
  return { values, wildcard }
}

/** An immutable, pre-validated cron expression. */
export class CronExpression {
  readonly expression: string
  private readonly minute: ParsedField
  private readonly hour: ParsedField
  private readonly dayOfMonth: ParsedField
  private readonly month: ParsedField
  private readonly dayOfWeek: ParsedField

  constructor(expression: string, parsed: readonly ParsedField[]) {
    this.expression = expression
    this.minute = parsed[0]!
    this.hour = parsed[1]!
    this.dayOfMonth = parsed[2]!
    this.month = parsed[3]!
    this.dayOfWeek = parsed[4]!
  }

  private dayMatches(day: number, weekday: number): boolean {
    const dom = this.dayOfMonth.wildcard
    const dow = this.dayOfWeek.wildcard
    if (dom && dow) return true
    if (dom) return this.dayOfWeek.values.has(weekday)
    if (dow) return this.dayOfMonth.values.has(day)
    return this.dayOfMonth.values.has(day) || this.dayOfWeek.values.has(weekday)
  }

  /** Smallest instant strictly after `afterMs`, aligned to a UTC minute boundary. */
  nextAfter(afterMs: number): number {
    if (!Number.isFinite(afterMs)) {
      fail('OUT_OF_RANGE', `cron nextAfter: ${String(afterMs)} is not a finite timestamp`)
    }
    let cursor = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS
    const horizon = cursor + MAX_SEARCH_MS
    while (cursor <= horizon) {
      const date = new Date(cursor)
      const month = date.getUTCMonth() + 1
      if (!this.month.values.has(month)) {
        cursor = Date.UTC(date.getUTCFullYear(), month, 1, 0, 0, 0)
        continue
      }
      if (!this.dayMatches(date.getUTCDate(), date.getUTCDay())) {
        cursor = cursor - (cursor % DAY_MS) + DAY_MS
        continue
      }
      if (!this.hour.values.has(date.getUTCHours())) {
        cursor = cursor - (cursor % HOUR_MS) + HOUR_MS
        continue
      }
      if (!this.minute.values.has(date.getUTCMinutes())) {
        cursor += MINUTE_MS
        continue
      }
      return cursor
    }
    fail('NO_MATCH', `cron "${this.expression}" has no matching instant within 5 years`)
  }
}

/** Parse and validate a 5-field cron expression; throws `CronExpressionError` otherwise. */
export function parseCronExpression(expression: string): CronExpression {
  if (typeof expression !== 'string' || expression.trim() === '') {
    fail('INVALID_FIELD_COUNT', 'cron expression must be a non-empty string')
  }
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    fail(
      'INVALID_FIELD_COUNT',
      `cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}: "${expression}"`,
    )
  }
  const parsed = parts.map((part, index) => parseField(part, FIELDS[index]!))
  return new CronExpression(expression, parsed)
}