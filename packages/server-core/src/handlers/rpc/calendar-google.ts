/**
 * Google Calendar connect/sync RPC handlers (wave 1).
 *
 * Owns the honest availability contract for the Google chip:
 *  - no `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` → `unavailable`
 *  - configured but no stored token → `disconnected`
 *  - stored token → `connected`
 *
 * The OAuth popup/callback broker is the existing sources broker
 * (`prepareGoogleOAuth`/`exchangeGoogleOAuth` + client-side callback server);
 * `calendar:googleConnect` is the server half of that flow, called twice:
 * once to prepare the auth URL and once to exchange the returned code.
 *
 * Tokens live in the shared credential manager for the calling principal
 * (`service_oauth::{workspaceId}::google-calendar`) — never in the renderer.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { getCredentialManager } from '@rox/shared/credentials'
import type { CredentialId } from '@rox/shared/credentials'
import { exchangeGoogleOAuth, isGoogleOAuthConfigured, prepareGoogleOAuth, refreshGoogleToken } from '@rox/shared/auth'
import {
  CalendarAuthExpiredError,
  CalendarProviderUnavailableError,
  CalendarStore,
  GoogleCalendarRestAdapter,
  googleCalendarSyncWindow,
} from '@rox/core/calendar'
import type { CalendarBundle, CalendarEvent } from '@rox/core/calendar'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const CALENDAR_CREDENTIAL_NAME = 'google-calendar'
const REFRESH_SKEW_MS = 5 * 60 * 1000
const PENDING_FLOW_TTL_MS = 5 * 60 * 1000

export type GoogleCalendarStatusState = 'unavailable' | 'disconnected' | 'connected'

export interface GoogleCalendarStatus {
  provider: 'google'
  state: GoogleCalendarStatusState
  /** Present only for `state: 'unavailable'`. */
  reason?: 'no-oauth-client'
}

export interface GoogleSyncCounts {
  added: number
  updated: number
  deleted: number
  total: number
  conflicts: number
  lastSyncAt: number
}

export interface GoogleSyncResult extends GoogleSyncCounts {
  ok: boolean
  code?: 'CALENDAR_AUTH_EXPIRED' | 'CALENDAR_NOT_CONNECTED'
  error?: string
}

interface PendingCalendarFlow {
  codeVerifier: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  tokenEndpoint: string
  workspaceId: string
  ownerClientId: string
  expiresAt: number
}

interface PersistedGoogleCalendar {
  email?: string
  accountId: string
  store: CalendarBundle
}

/** Pending prepares, keyed by OAuth `state`. Server-side only; never serialized. */
const pendingFlows = new Map<string, PendingCalendarFlow>()

function googleCredentialId(workspaceId: string): CredentialId {
  return { type: 'service_oauth', workspaceId, name: CALENDAR_CREDENTIAL_NAME }
}

function prunePendingFlows(now = Date.now()): void {
  for (const [state, flow] of pendingFlows) {
    if (now > flow.expiresAt) pendingFlows.delete(state)
  }
}

function workspaceRootFor(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function calendarStatePath(rootPath: string): string {
  return join(rootPath, '.rox', 'calendar', 'google.json')
}

function readPersisted(rootPath: string): PersistedGoogleCalendar | null {
  const path = calendarStatePath(rootPath)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PersistedGoogleCalendar>
    if (!parsed.store) return null
    return { email: parsed.email, accountId: parsed.accountId ?? '', store: parsed.store }
  } catch {
    return null
  }
}

function writePersisted(rootPath: string, data: PersistedGoogleCalendar): void {
  const path = calendarStatePath(rootPath)
  mkdirSync(join(rootPath, '.rox', 'calendar'), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * Ensure the persisted bundle carries exactly one connected google account.
 * Idempotent: reuses the existing account id on every sync.
 */
function ensureGoogleAccount(store: CalendarStore, persisted: PersistedGoogleCalendar | null, email?: string): { accountId: string } {
  const existing = store.accounts().find((account) => account.provider === 'google' && account.status !== 'revoked')
  if (existing) {
    if (existing.status !== 'connected') store.markConnected(existing.id)
    return { accountId: existing.id }
  }
  const account = store.connect('google', email ?? persisted?.email ?? 'Google Calendar', 'UTC')
  store.markConnected(account.id)
  return { accountId: account.id }
}

function eventRevision(event: CalendarEvent): string {
  return JSON.stringify([event.title, event.startAt, event.endAt, event.allDay, event.timeZone, event.deleted, event.etag])
}

function eventSnapshot(store: CalendarStore): Map<string, string> {
  return new Map(store.events().map((event) => [JSON.stringify([event.accountId, event.calendarId, event.id]), eventRevision(event)]))
}

/**
 * Access-token callback handed to the adapter. Refreshes near-expiry tokens and
 * persists the rotated access token; failures surface as typed auth errors.
 */
async function googleAccessToken(credId: CredentialId): Promise<string> {
  const manager = getCredentialManager()
  const cred = await manager.get(credId)
  if (!cred?.value) throw new CalendarProviderUnavailableError('google')
  if (!cred.expiresAt || cred.expiresAt - REFRESH_SKEW_MS > Date.now()) return cred.value
  if (!cred.refreshToken) throw new CalendarAuthExpiredError('google', 'Google Calendar refresh token is missing')
  const refreshed = await refreshGoogleToken(cred.refreshToken, cred.clientId, cred.clientSecret)
  await manager.set(credId, { ...cred, value: refreshed.accessToken, expiresAt: refreshed.expiresAt })
  return refreshed.accessToken
}

export function registerCalendarGoogleHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // ── calendar:googleStatus ───────────────────────────────────
  server.handle(RPC_CHANNELS.calendar.GOOGLE_STATUS, async (ctx): Promise<GoogleCalendarStatus> => {
    if (!isGoogleOAuthConfigured()) return { provider: 'google', state: 'unavailable', reason: 'no-oauth-client' }
    if (!ctx.workspaceId) return { provider: 'google', state: 'disconnected' }
    const cred = await getCredentialManager().get(googleCredentialId(ctx.workspaceId))
    return { provider: 'google', state: cred?.value ? 'connected' : 'disconnected' }
  })

  // ── calendar:googleConnect ──────────────────────────────────
  // Two-phase on one channel, mirroring the sources broker
  // (prepare → client opens browser → complete with the code).
  server.handle(RPC_CHANNELS.calendar.GOOGLE_CONNECT, async (ctx, args: {
    callbackUrl?: string
    callbackPort?: number
    code?: string
    state?: string
  } = {}) => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    if (!isGoogleOAuthConfigured()) {
      return { ok: false as const, code: 'no-oauth-client' as const, error: 'Google OAuth client is not configured' }
    }

    prunePendingFlows()

    if (args.code && args.state) {
      const flow = pendingFlows.get(args.state)
      if (!flow) return { ok: false as const, code: 'unknown-flow' as const, error: 'Unknown or expired OAuth flow' }
      if (flow.workspaceId !== ctx.workspaceId || flow.ownerClientId !== ctx.clientId) {
        return { ok: false as const, code: 'unknown-flow' as const, error: 'OAuth flow belongs to a different client' }
      }
      pendingFlows.delete(args.state)

      const result = await exchangeGoogleOAuth({
        code: args.code,
        codeVerifier: flow.codeVerifier,
        tokenEndpoint: flow.tokenEndpoint,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
        redirectUri: flow.redirectUri,
      })
      if (!result.success || !result.accessToken) {
        log.warn(`[Calendar:google] OAuth exchange failed: ${result.error ?? 'no access token'}`)
        return { ok: false as const, code: 'oauth-failed' as const, error: result.error ?? 'OAuth exchange failed' }
      }

      await getCredentialManager().set(googleCredentialId(ctx.workspaceId), {
        value: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        clientId: result.oauthClientId,
        clientSecret: result.oauthClientSecret,
        tokenType: 'Bearer',
        source: 'native',
      })

      const rootPath = workspaceRootFor(ctx.workspaceId)
      const persisted = readPersisted(rootPath)
      const store = new CalendarStore(persisted?.store)
      const { accountId } = ensureGoogleAccount(store, persisted, result.email)
      writePersisted(rootPath, { email: result.email, accountId, store: store.snapshot() })

      log.info('[Calendar:google] connect complete')
      return { ok: true as const, email: result.email }
    }

    if (!args.callbackUrl && !args.callbackPort) {
      throw new Error('calendar:googleConnect requires callbackUrl or callbackPort to prepare a flow')
    }

    const prepared = prepareGoogleOAuth({
      service: 'calendar',
      callbackUrl: args.callbackUrl,
      callbackPort: args.callbackPort,
    })
    pendingFlows.set(prepared.state, {
      codeVerifier: prepared.codeVerifier,
      redirectUri: prepared.redirectUri,
      clientId: prepared.clientId,
      clientSecret: prepared.clientSecret,
      tokenEndpoint: prepared.tokenEndpoint,
      workspaceId: ctx.workspaceId,
      ownerClientId: ctx.clientId,
      expiresAt: Date.now() + PENDING_FLOW_TTL_MS,
    })
    log.info(`[Calendar:google] connect flow prepared (flow=${randomUUID().slice(0, 8)})`)
    return { ok: true as const, authUrl: prepared.authUrl, state: prepared.state }
  })

  // ── calendar:googleDisconnect ───────────────────────────────
  server.handle(RPC_CHANNELS.calendar.GOOGLE_DISCONNECT, async (ctx) => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    const rootPath = workspaceRootFor(ctx.workspaceId)
    await getCredentialManager().delete(googleCredentialId(ctx.workspaceId))

    const persisted = readPersisted(rootPath)
    if (persisted) {
      const store = new CalendarStore(persisted.store)
      for (const account of store.accounts().filter((item) => item.provider === 'google')) {
        store.revoke(account.id)
      }
      writePersisted(rootPath, { ...persisted, store: store.snapshot() })
    }
    log.info('[Calendar:google] disconnected')
    return { success: true }
  })

  // ── calendar:googleSync ─────────────────────────────────────
  server.handle(RPC_CHANNELS.calendar.GOOGLE_SYNC, async (ctx): Promise<GoogleSyncResult> => {
    if (!ctx.workspaceId) throw new Error('No workspace bound to this client')
    const rootPath = workspaceRootFor(ctx.workspaceId)
    const credId = googleCredentialId(ctx.workspaceId)
    const cred = await getCredentialManager().get(credId)
    if (!cred?.value) {
      return { ok: false, code: 'CALENDAR_NOT_CONNECTED', error: 'Google Calendar is not connected',
        added: 0, updated: 0, deleted: 0, total: 0, conflicts: 0, lastSyncAt: 0 }
    }

    const persisted = readPersisted(rootPath)
    const store = new CalendarStore(persisted?.store)
    const { accountId } = ensureGoogleAccount(store, persisted, persisted?.email)
    const { timeMin, timeMax } = googleCalendarSyncWindow()
    const adapter = new GoogleCalendarRestAdapter({
      accessToken: () => googleAccessToken(credId),
      timeMin,
      timeMax,
      timeZone: 'UTC',
    })

    const before = eventSnapshot(store)
    try {
      await store.sync(accountId, adapter)
    } catch (error) {
      if (error instanceof CalendarAuthExpiredError) {
        return { ok: false, code: 'CALENDAR_AUTH_EXPIRED', error: error.message,
          added: 0, updated: 0, deleted: 0, total: 0, conflicts: 0, lastSyncAt: 0 }
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
    writePersisted(rootPath, { ...persisted, accountId, store: store.snapshot() })

    const conflicts = store.conflicts().length
    log.info(`[Calendar:google] sync +${added} ~${updated} -${deleted} (conflicts=${conflicts})`)
    return { ok: true, added, updated, deleted, total: store.events().length, conflicts, lastSyncAt: now }
  })
}