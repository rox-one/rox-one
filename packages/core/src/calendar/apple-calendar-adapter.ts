/**
 * Live Apple Calendar adapter (macOS EventKit).
 *
 * EventKit is not reachable from JS, so a small Swift helper binary
 * (`apps/electron/native/rox-calendar-helper`) speaks single-line JSON over
 * stdout. The host injects the process spawner through
 * `registerAppleCalendarHelper` and this module stays free of Node process/fs
 * imports so it can be bundled into the renderer alongside the seam.
 *
 * Fail-closed: the adapter is only constructed by `createProductionAdapter` when
 * the APPLE_CALENDAR_LIVE=1 gate is set, the platform is darwin, AND a registered
 * helper binding reports the binary is present. Otherwise the calendar seam keeps
 * returning the honest Unavailable adapter.
 */

import type { CalendarAdapter, CalendarListPage } from './adapters.ts'
import { capabilityFor } from './capabilities.ts'
import type { CalendarEvent, CalendarProvider } from './types.ts'

/** Opt-in gate for the live Apple Calendar adapter. Absent = always unavailable. */
export const APPLE_CALENDAR_LIVE_ENV = 'APPLE_CALENDAR_LIVE'

export function appleCalendarLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[APPLE_CALENDAR_LIVE_ENV] === '1'
}

/** EventKit authorization states surfaced by the helper's `auth-status` subcommand. */
export type AppleCalendarAuthStatus =
  | 'notDetermined'
  | 'denied'
  | 'authorized'
  | 'restricted'
  | 'limited'

/** Raw result of one helper invocation. Never logged or serialized by this module. */
export interface AppleCalendarHelperResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Outcome of `request-access`: the resulting state plus whether macOS granted it. */
export interface AppleCalendarAccessResult {
  status: AppleCalendarAuthStatus
  granted: boolean
}

/** Injected process spawner: runs the helper with `args` and returns raw output. */
export type AppleCalendarRunHelper = (args: readonly string[]) => Promise<AppleCalendarHelperResult>

/**
 * Injected view of the host's helper binary.
 *
 * `hasHelper` must be synchronous so `CalendarAdapter.available()` stays synchronous;
 * hosts compute it once as "darwin && bundled helper exists".
 */
export interface AppleCalendarHelperBinding {
  hasHelper(): boolean
  run(args: readonly string[]): Promise<AppleCalendarHelperResult>
}

let helperBinding: AppleCalendarHelperBinding | null = null

/** Wire (or clear) the host helper. Passing null disables the live adapter. */
export function registerAppleCalendarHelper(binding: AppleCalendarHelperBinding | null): void {
  helperBinding = binding
}

export function getAppleCalendarHelper(): AppleCalendarHelperBinding | null {
  return helperBinding
}

export class AppleCalendarUnavailableError extends Error {
  readonly code = 'APPLE_CALENDAR_UNAVAILABLE' as const
  constructor(message = 'Apple Calendar helper is not available on this device') {
    super(message)
    this.name = 'AppleCalendarUnavailableError'
  }
}

export class AppleCalendarAuthDeniedError extends Error {
  readonly code = 'APPLE_CALENDAR_AUTH_DENIED' as const
  constructor(readonly status: AppleCalendarAuthStatus, message = `Apple Calendar access is ${status}`) {
    super(message)
    this.name = 'AppleCalendarAuthDeniedError'
  }
}

export class AppleCalendarHelperError extends Error {
  readonly code = 'APPLE_CALENDAR_HELPER' as const
  constructor(readonly exitCode: number, message: string) {
    super(message)
    this.name = 'AppleCalendarHelperError'
  }
}

/** Event listing window. Values are epoch ms, Date, or RFC3339 strings. */
export interface AppleCalendarRange {
  start: number | string | Date
  end: number | string | Date
}

/** Raw event row emitted by the helper's `list-events` subcommand. */
export interface AppleCalendarHelperEvent {
  id: string
  title?: string
  startAt: string
  endAt: string
  allDay?: boolean
  calendarId?: string
  notes?: string
  location?: string
  hasRecurrence?: boolean
  occurrenceOf?: string
}

export interface AppleCalendarAdapterOptions {
  runHelper: AppleCalendarRunHelper
  /** Sync availability probe. Defaults to `() => true` for direct construction. */
  helperPresent?: () => boolean
  /** Calendar id to list. Defaults to every calendar the helper returns. */
  calendarId?: string
  /** Fixed window; when omitted a rolling default around `now()` is used. */
  range?: AppleCalendarRange
  now?: () => number
  /** Fallback IANA zone when the event carries none. Defaults to UTC. */
  timeZone?: string
}

const DAY_MS = 86_400_000

/** Read a string `error` code from a parsed helper payload, if any. */
function readHelperErrorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  return typeof value.error === 'string' ? value.error : null
}

/** Map a helper error code to a typed auth failure when it is authorization-related. */
function authStatusFromCode(code: string): AppleCalendarAuthStatus | null {
  switch (code) {
    case 'auth-denied':
    case 'denied':
      return 'denied'
    case 'auth-restricted':
    case 'restricted':
      return 'restricted'
    case 'auth-not-determined':
    case 'notDetermined':
    case 'not-determined':
      return 'notDetermined'
    default:
      return null
  }
}

/**
 * Live adapter over the macOS EventKit helper.
 *
 * `listEvents(accountId)` uses the configured/default range; the interface's optional `cursor` is
 * unused because one EventKit query returns the full window in a single pass.
 * `listEventsInRange` exposes an explicit window for callers that know the sync
 * period.
 */
export class AppleCalendarAdapter implements CalendarAdapter {
  readonly mode = 'live' as const
  readonly provider: CalendarProvider = 'appleCalendar'
  readonly capabilities = capabilityFor('appleCalendar')
  private readonly runHelper: AppleCalendarRunHelper
  private readonly helperPresent: () => boolean
  private readonly calendarId?: string
  private readonly configuredRange?: AppleCalendarRange
  private readonly now: () => number
  private readonly timeZone: string

  constructor(options: AppleCalendarAdapterOptions) {
    this.runHelper = options.runHelper
    this.helperPresent = options.helperPresent ?? (() => true)
    this.calendarId = options.calendarId
    this.configuredRange = options.range
    this.now = options.now ?? Date.now
    this.timeZone = options.timeZone ?? 'UTC'
  }

  available(): boolean {
    return this.helperPresent()
  }

  async listEvents(accountId: string): Promise<CalendarListPage> {
    return this.listEventsInRange(accountId, this.currentRange())
  }

  async listEventsInRange(accountId: string, range: AppleCalendarRange): Promise<CalendarListPage> {
    if (!this.available()) {
      throw new AppleCalendarUnavailableError()
    }
    await this.ensureAuthorized()

    const start = typeof range.start === 'string' ? range.start : new Date(range.start).toISOString()
    const end = typeof range.end === 'string' ? range.end : new Date(range.end).toISOString()
    const args = ['list-events', '--start', start, '--end', end]
    if (this.calendarId) args.push('--calendar', this.calendarId)

    const payload = await this.invoke(args)
    // Helper contract: list-events emits a JSON array of event rows.
    const rows = Array.isArray(payload) ? (payload as AppleCalendarHelperEvent[]) : []
    return { events: rows.map((row) => this.mapEvent(row, accountId)) }
  }

  private currentRange(): AppleCalendarRange {
    if (this.configuredRange) return this.configuredRange
    const now = this.now()
    return { start: now - 30 * DAY_MS, end: now + 90 * DAY_MS }
  }

  /**
   * Read the EventKit authorization state without prompting (`auth-status` is
   * read-only). Throws `AppleCalendarHelperError` when the helper is unreachable
   * or answers with an unknown status.
   */
  async authStatus(): Promise<AppleCalendarAuthStatus> {
    return this.readAuthStatus(await this.invoke(['auth-status']))
  }

  /**
   * Ask macOS for Calendar access (`request-access`). Triggers the one-time TCC
   * prompt when the state is `notDetermined`; on an already-decided state it
   * returns the current status without a prompt. Never throws for a denial —
   * callers inspect `granted`/`status`.
   */
  async requestAccess(): Promise<AppleCalendarAccessResult> {
    const payload = await this.invoke(['request-access'])
    const status = this.readAuthStatus(payload)
    const granted = typeof payload === 'object' && payload !== null && 'granted' in payload
      ? payload.granted === true
      : status === 'authorized' || status === 'limited'
    return { status, granted }
  }

  /** Refuse to list until the host reports full (or limited) EventKit access. */
  private async ensureAuthorized(): Promise<void> {
    const status = await this.authStatus()
    if (status === 'authorized' || status === 'limited') return
    throw new AppleCalendarAuthDeniedError(status)
  }

  private readAuthStatus(payload: unknown): AppleCalendarAuthStatus {
    const status = typeof payload === 'object' && payload !== null && 'status' in payload ? payload.status : undefined
    if (
      status === 'authorized' ||
      status === 'limited' ||
      status === 'denied' ||
      status === 'restricted' ||
      status === 'notDetermined'
    ) {
      return status
    }
    throw new AppleCalendarHelperError(0, `Apple Calendar helper returned unknown auth status: ${String(status)}`)
  }

  /** One helper call: parse stdout, translate failures into typed errors. */
  private async invoke(args: readonly string[]): Promise<unknown> {
    let result: AppleCalendarHelperResult
    try {
      result = await this.runHelper(args)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new AppleCalendarHelperError(1, `Apple Calendar helper ${args[0] ?? ''} could not start: ${detail}`)
    }
    let parsed: unknown = null
    const stdout = result.stdout.trim()
    if (stdout) {
      try {
        parsed = JSON.parse(stdout)
      } catch {
        parsed = null
      }
    }

    if (result.exitCode !== 0) {
      const code = readHelperErrorCode(parsed) ?? `exit-${result.exitCode}`
      const authStatus = authStatusFromCode(code)
      if (authStatus) throw new AppleCalendarAuthDeniedError(authStatus)
      throw new AppleCalendarHelperError(
        result.exitCode,
        `Apple Calendar helper ${args[0] ?? ''} failed: ${code}`,
      )
    }

    const helperError = readHelperErrorCode(parsed)
    if (helperError) {
      const authStatus = authStatusFromCode(helperError)
      if (authStatus) throw new AppleCalendarAuthDeniedError(authStatus)
      throw new AppleCalendarHelperError(0, `Apple Calendar helper ${args[0] ?? ''} failed: ${helperError}`)
    }

    return parsed
  }

  private mapEvent(row: AppleCalendarHelperEvent, accountId: string): CalendarEvent {
    const startAt = Date.parse(row.startAt)
    const endAt = Date.parse(row.endAt)
    return {
      id: row.id,
      accountId,
      calendarId: row.calendarId ?? this.calendarId ?? 'default',
      title: row.title ?? '',
      startAt: Number.isFinite(startAt) ? startAt : 0,
      endAt: Number.isFinite(endAt) ? endAt : 0,
      allDay: row.allDay ?? false,
      timeZone: this.timeZone,
      recurrence: row.hasRecurrence ? 'recurring' : undefined,
      occurrenceId: row.occurrenceOf ? row.id : undefined,
      deleted: false,
      kind: 'event',
    }
  }
}