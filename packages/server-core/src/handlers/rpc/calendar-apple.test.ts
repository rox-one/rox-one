import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import {
  APPLE_CALENDAR_LIVE_ENV,
  appleCalendarLiveEnabled,
  getAppleCalendarHelper,
  registerAppleCalendarHelper,
  type AppleCalendarHelperResult,
} from '@rox/core/calendar'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'acal-handler-'))
afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }))

mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => ({ id, rootPath: workspaceRoot }),
}))

// The handler must be imported AFTER the mock.module registration above — bun
// evaluates static imports before top-level statements, so a static import here
// would capture the real module.
const { registerCalendarAppleHandlers } = await import('./calendar-apple.ts')

type Handler = (ctx: { workspaceId?: string; clientId: string }, args?: unknown) => Promise<unknown>

const HELPER_EVENTS = [
  { id: 'evt-1', title: 'Standup', startAt: '2026-10-02T09:00:00Z', endAt: '2026-10-02T09:30:00Z', calendarId: 'cal-work' },
  { id: 'evt-2', title: 'Lunch', startAt: '2026-10-02T12:00:00Z', endAt: '2026-10-02T13:00:00Z', calendarId: 'cal-home' },
]

/** Helper stub: `auth-status` / `request-access` / `list-events` answers. */
function registerStubHelper(access: 'authorized' | 'denied'): void {
  const run = async (args: readonly string[]): Promise<AppleCalendarHelperResult> => {
    switch (args[0]) {
      case 'auth-status':
        return { exitCode: 0, stdout: JSON.stringify({ status: access }), stderr: '' }
      case 'request-access':
        return { exitCode: 0, stdout: JSON.stringify({ status: access, granted: access === 'authorized' }), stderr: '' }
      case 'list-events':
        return { exitCode: 0, stdout: JSON.stringify(HELPER_EVENTS), stderr: '' }
      default:
        return { exitCode: 1, stdout: JSON.stringify({ error: 'unknown-command' }), stderr: '' }
    }
  }
  registerAppleCalendarHelper({ hasHelper: () => true, run })
}

function fixture(): { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const server = { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn) } }
  registerCalendarAppleHandlers(server as never, {
    platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
  } as never)
  return { handlers }
}

const ctx = { workspaceId: 'ws-1', clientId: 'client-1' }

const originalGate = process.env[APPLE_CALENDAR_LIVE_ENV]

beforeEach(() => {
  registerAppleCalendarHelper(null)
  delete process.env[APPLE_CALENDAR_LIVE_ENV]
})

afterEach(() => {
  if (originalGate === undefined) delete process.env[APPLE_CALENDAR_LIVE_ENV]
  else process.env[APPLE_CALENDAR_LIVE_ENV] = originalGate
  registerAppleCalendarHelper(null)
})

describe('calendar:apple handlers', () => {
  it('reports unavailable with the gate off and never touches the helper', async () => {
    registerStubHelper('authorized')
    const { handlers } = fixture()

    expect(appleCalendarLiveEnabled()).toBe(false)
    expect(getAppleCalendarHelper()?.hasHelper()).toBe(true)
    expect(await handlers.get(RPC_CHANNELS.calendar.APPLE_STATUS)!(ctx)).toEqual({
      provider: 'appleCalendar',
      state: 'unavailable',
      reason: 'gate-disabled',
    })
  })

  it('reports unavailable with the gate on but no registered helper', async () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    const { handlers } = fixture()

    expect(await handlers.get(RPC_CHANNELS.calendar.APPLE_STATUS)!(ctx)).toEqual({
      provider: 'appleCalendar',
      state: 'unavailable',
      reason: 'no-helper',
    })
  })

  it('refuses to connect without a live helper and reports no events', async () => {
    const { handlers } = fixture()
    const result = await handlers.get(RPC_CHANNELS.calendar.APPLE_CONNECT)!(ctx) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('unavailable')
  })

  it('reports denied on connect when macOS denies EventKit access — no account persisted', async () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerStubHelper('denied')
    const { handlers } = fixture()

    expect(await handlers.get(RPC_CHANNELS.calendar.APPLE_STATUS)!(ctx)).toEqual({
      provider: 'appleCalendar',
      state: 'denied',
      authStatus: 'denied',
    })

    const connected = await handlers.get(RPC_CHANNELS.calendar.APPLE_CONNECT)!(ctx) as { ok: boolean; granted: boolean; code?: string; status?: string }
    expect(connected).toMatchObject({ ok: false, granted: false, code: 'denied', status: 'denied' })

    const sync = await handlers.get(RPC_CHANNELS.calendar.APPLE_SYNC)!(ctx) as { ok: boolean; code?: string; total: number; added: number }
    expect(sync.ok).toBe(false)
    expect(sync.code).toBe('CALENDAR_NOT_CONNECTED')
    expect(sync.total).toBe(0)
    expect(sync.added).toBe(0)
  })

  it('connects when authorized, reports connected, then syncs real helper events', async () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerStubHelper('authorized')
    const { handlers } = fixture()

    expect(await handlers.get(RPC_CHANNELS.calendar.APPLE_STATUS)!(ctx)).toEqual({
      provider: 'appleCalendar',
      state: 'connected',
      authStatus: 'authorized',
    })

    const connected = await handlers.get(RPC_CHANNELS.calendar.APPLE_CONNECT)!(ctx) as { ok: boolean; granted: boolean; status?: string }
    expect(connected).toMatchObject({ ok: true, granted: true, status: 'authorized' })

    const sync = await handlers.get(RPC_CHANNELS.calendar.APPLE_SYNC)!(ctx) as { ok: boolean; added: number; total: number; lastSyncAt: number }
    expect(sync.ok).toBe(true)
    expect(sync.added).toBe(2)
    expect(sync.total).toBe(2)
    expect(sync.lastSyncAt).toBeGreaterThan(0)
  })

  it('disconnects by revoking the persisted account', async () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerStubHelper('authorized')
    const { handlers } = fixture()

    await handlers.get(RPC_CHANNELS.calendar.APPLE_CONNECT)!(ctx)
    expect(await handlers.get(RPC_CHANNELS.calendar.APPLE_DISCONNECT)!(ctx)).toEqual({ success: true })

    const sync = await handlers.get(RPC_CHANNELS.calendar.APPLE_SYNC)!(ctx) as { ok: boolean; code?: string }
    expect(sync.ok).toBe(false)
    expect(sync.code).toBe('CALENDAR_NOT_CONNECTED')
  })

  it('refuses to sync without a bound workspace', async () => {
    process.env[APPLE_CALENDAR_LIVE_ENV] = '1'
    registerStubHelper('authorized')
    const { handlers } = fixture()
    await expect(handlers.get(RPC_CHANNELS.calendar.APPLE_SYNC)!({ clientId: 'client-1' })).rejects.toThrow(/No workspace/)
  })
})