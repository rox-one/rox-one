/**
 * Apple Calendar (macOS EventKit) connect/sync RPC handlers (R8).
 *
 * Owns the honest availability contract for the Apple chip. The host registers
 * the EventKit helper binding (`registerAppleCalendarHelper`, gated behind
 * `APPLE_CALENDAR_LIVE=1` + a present binary); this module never spawns the
 * helper itself — it drives the live `AppleCalendarAdapter`:
 *  - gate off or no registered helper  → `unavailable` (never a fake "connected")
 *  - helper present, auth `notDetermined` → `disconnected`
 *  - helper present, auth `denied`/`restricted` → `denied`
 *  - helper present, auth `authorized`/`limited` → `connected`
 *
 * `calendar:appleConnect` runs the helper's `request-access` subcommand — the
 * one place macOS shows its TCC prompt — and reports the result verbatim. A
 * denial throws no events: sync is refused with `CALENDAR_AUTH_DENIED`.
 *
 * Read-only: this connector lists events and never writes to the user's
 * calendars (the Swift helper exposes no write path).
 *
 * Persisted bundle lives in `.rox/calendar/apple.json` for the calling
 * workspace; the helper binary path never leaves the host process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import {
  AppleCalendarAdapter,
  AppleCalendarAuthDeniedError,
  AppleCalendarUnavailableError,
  CalendarStore,
  appleCalendarLiveEnabled,
  createProductionAdapter,
  getAppleCalendarHelper,
} from '@rox/core/calendar'
import type { AppleCalendarAuthStatus, CalendarBundle, CalendarEvent } from '@rox/core/calendar'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export type AppleCalendarStatusState = 'unavailable' | 'disconnected' | 'denied' | 'connected'

export type AppleCalendarStatusReason = 'gate-disabled' | 'no-helper' | 'helper-error'

export interface AppleCalendarStatus {
  provider: 'appleCalendar'
  state: AppleCalendarStatusState
  /** Present only for `state: 'unavailable'`. */
  reason?: AppleCalendarStatusReason
  /** Raw EventKit state when the helper answered. */
  authStatus?: AppleCalendarAuthStatus
}

export type AppleCalendarSyncCode = 'CALENDAR_NOT_CONNECTED' | 'CALENDAR_AUTH_DENIED' | 'CALENDAR_UNAVAILABLE'

export interface AppleSyncCounts {
  added: number
  updated: number
  deleted: number
  total: number
  conflicts: number
  lastSyncAt: number
}

export interface AppleSyncResult extends AppleSyncCounts {
  ok: boolean
  code?: AppleCalendarSyncCode
  error?: string
}

export type AppleConnectResult =
  | { ok: true; granted: true; status: AppleCalendarAuthStatus }
  | { ok: false; granted: false; code: 'unavailable' | 'denied'; status?: AppleCalendarAuthStatus; error: string }

interface PersistedAppleCalendar {
  accountId: string
  store: CalendarBundle
}

function workspaceRootFor(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function calendarStatePath(rootPath: string): string {
  return join(rootPath, '.rox', 'calendar', 'apple.json')
}

function readPersisted(rootPath: string): PersistedAppleCalendar | null {
  const path = calendarStatePath(rootPath)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedAppleCalendar>
    if (!parsed.store) return null
    return { accountId: parsed.accountId ?? '', store: parsed.store }
  } catch {
    return null
  }
}

function writePersisted(rootPath: string, data: PersistedAppleCalendar): void {
  mkdirSync(join(rootPath, '.rox', 'calendar'), { recursive: true })
  writeFileSync(calendarStatePath(rootPath), JSON.stringify(data, null, 2), 'utf8')
}

/** Ensure the persisted bundle carries exactly one connected apple account. Idempotent. */
function ensureAppleAccount(store: CalendarStore, persisted: PersistedAppleCalendar | null): { accountId: string } {
  const existing = store.accounts().find((account) => account.provider === 'appleCalendar' && account.status !== 'revoked')
  if (existing) {
    if (existing.status !== 'connected') store.markConnected(existing.id)
    return { accountId: existing.id }
  }
  const account = store.connect('appleCalendar', 'Apple Calendar', 'UTC')
  store.markConnected(account.id)
  return { accountId: account.id }
}

function eventRevision(event: CalendarEvent): string {
  return JSON.stringify([event.title, event.startAt, event.endAt, event.allDay, event.timeZone, event.deleted, event.etag])
}

function eventSnapshot(store: CalendarStore): Map<string, string> {
  return new Map(store.events().map((event) => [JSON.stringify([event.accountId, event.calendarId, event.id]), eventRevision(event)]))
}

function emptySync(code: AppleCalendarSyncCode, error: string): AppleSyncResult {
  return { ok: false, code, error, added: 0, updated: 0, deleted: 0, total: 0, conflicts: 0, lastSyncAt: 0 }
}

/** The wired live adapter, or `null` when the gate is off or no helper is registered. */
function liveAppleAdapter(): AppleCalendarAdapter | null {
  const adapter = createProductionAdapter('appleCalendar')
  return adapter instanceof AppleCalendarAdapter ? adapter : null
}

export function registerCalendarAppleHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // ── calendar:appleStatus ────────────────────────────────────
  server.handle(RPC_CHANNELS.calendar.APPLE_STATUS, async (): Promise<AppleCalendarStatus> => {
    const adapter = liveAppleAdapter()
    if (!adapter) {
      return {
        provider: 'appleCalendar',
        state: 'unavailable',
        reason: appleCalendarLiveEnabled() ? 'no-helper' : 'gate-disabled',
      }
    }
    try {
      const authStatus = await adapter.authStatus()
      if (authStatus === 'authorized' || authStatus === 'limited') {
        return { provider: 'appleCalendar', state: 'connected', authStatus }
      }
      if (authStatus === 'denied' || authStatus === 'restricted') {
        return { provider: 'appleCalendar', state: 'denied', authStatus }
      }
      return { provider: 'appleCalendar', state: 'disconnected', authStatus }
    } catch (error) {
      log.warn(`[Calendar:apple] auth-status probe failed: ${error instanceof Error ? error.message : String(error)}`)
      return { provider: 'appleCalendar', state: 'unavailable', reason: 'helper-error' }
    }
  })

  // ── calendar:appleConnect ───────────────────────────────────
  // macOS shows its permission prompt here (helper `request-access`). A denial
  // is reported as-is — no account is persisted and sync stays refused.
  server.handle(RPC_CHANNELS.calendar.APPLE_CONNECT, async (ctx): Promise<AppleConnectResult> => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    const adapter = liveAppleAdapter()
    if (!adapter) {
      return { ok: false, granted: false, code: 'unavailable', error: 'Apple Calendar helper is not available on this device' }
    }

    const { status, granted } = await adapter.requestAccess()
    if (!granted || (status !== 'authorized' && status !== 'limited')) {
      log.info(`[Calendar:apple] access ${status}`)
      return { ok: false, granted: false, code: 'denied', status, error: `Apple Calendar access is ${status}` }
    }

    const rootPath = workspaceRootFor(ctx.workspaceId)
    const persisted = readPersisted(rootPath)
    const store = new CalendarStore(persisted?.store)
    const { accountId } = ensureAppleAccount(store, persisted)
    writePersisted(rootPath, { accountId, store: store.snapshot() })

    log.info('[Calendar:apple] connected')
    return { ok: true, granted: true, status }
  })

  // ── calendar:appleDisconnect ────────────────────────────────
  // Revokes the local account only. macOS TCC grants are user-owned and cannot
  // be dropped by the app; the user revokes them in System Settings.
  server.handle(RPC_CHANNELS.calendar.APPLE_DISCONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    const rootPath = workspaceRootFor(ctx.workspaceId)
    const persisted = readPersisted(rootPath)
    if (persisted) {
      const store = new CalendarStore(persisted.store)
      for (const account of store.accounts().filter((item) => item.provider === 'appleCalendar')) {
        store.revoke(account.id)
      }
      writePersisted(rootPath, { ...persisted, store: store.snapshot() })
    }
    log.info('[Calendar:apple] disconnected')
    return { success: true }
  })

  // ── calendar:appleSync ──────────────────────────────────────
  server.handle(RPC_CHANNELS.calendar.APPLE_SYNC, async (ctx): Promise<AppleSyncResult> => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    const adapter = liveAppleAdapter()
    if (!adapter) return emptySync('CALENDAR_UNAVAILABLE', 'Apple Calendar helper is not available on this device')

    const rootPath = workspaceRootFor(ctx.workspaceId)
    const persisted = readPersisted(rootPath)
    const store = new CalendarStore(persisted?.store)
    const account = store.accounts().find((item) => item.provider === 'appleCalendar' && item.status === 'connected')
    if (!account) return emptySync('CALENDAR_NOT_CONNECTED', 'Apple Calendar is not connected')

    const before = eventSnapshot(store)
    try {
      await store.sync(account.id, adapter)
    } catch (error) {
      if (error instanceof AppleCalendarAuthDeniedError) {
        return emptySync('CALENDAR_AUTH_DENIED', error.message)
      }
      if (error instanceof AppleCalendarUnavailableError) {
        return emptySync('CALENDAR_UNAVAILABLE', error.message)
      }
      throw error
    }

    const after = eventSnapshot(store)
    let added = 0
    let updated = 0
    for (const [key, revision] of after) {
      const previous = before.get(key)
      if (previous === undefined) added += 1
      else if (previous !== revision) updated += 1
    }
    let deleted = 0
    for (const key of before.keys()) if (!after.has(key)) deleted += 1

    const now = Date.now()
    writePersisted(rootPath, { ...persisted, accountId: account.id, store: store.snapshot() })

    const conflicts = store.conflicts().length
    log.info(`[Calendar:apple] sync +${added} ~${updated} -${deleted} (conflicts=${conflicts})`)
    return { ok: true, added, updated, deleted, total: store.events().length, conflicts, lastSyncAt: now }
  })
}