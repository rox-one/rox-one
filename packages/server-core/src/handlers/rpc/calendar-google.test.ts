import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@rox/shared/protocol'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'gcal-handler-'))
afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }))

const credentials = new Map<string, { value: string; refreshToken?: string; expiresAt?: number; clientId?: string; clientSecret?: string }>()

mock.module('@rox/shared/credentials', () => ({
  getCredentialManager: () => ({
    async get(id: unknown) { return credentials.get(JSON.stringify(id)) ?? null },
    async set(id: unknown, value: { value: string }) { credentials.set(JSON.stringify(id), value) },
    async delete(id: unknown) { return credentials.delete(JSON.stringify(id)) },
  }),
}))

mock.module('@rox/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => ({ id, rootPath: workspaceRoot }),
}))

const authState = { configured: false, exchangeOk: true }

mock.module('@rox/shared/auth', () => ({
  isGoogleOAuthConfigured: () => authState.configured,
  prepareGoogleOAuth: () => ({
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    state: 'state-1',
    codeVerifier: 'verifier-1',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUri: 'http://localhost:6477/callback',
    provider: 'google',
  }),
  exchangeGoogleOAuth: async () => authState.exchangeOk
    ? { success: true, accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3_600_000, email: 'user@example.org', oauthClientId: 'client-1', oauthClientSecret: 'secret-1' }
    : { success: false, error: 'denied' },
  refreshGoogleToken: async () => ({ accessToken: 'access-refreshed', expiresAt: Date.now() + 3_600_000 }),
}))

// The handler must be imported AFTER the mock.module registrations above —
// bun evaluates static imports before top-level statements, so a static import
// here would capture the real modules. This is a test module-loading boundary.
const { registerCalendarGoogleHandlers } = await import('./calendar-google.ts')

type Handler = (ctx: { workspaceId?: string; clientId: string }, args?: unknown) => Promise<unknown>

function fixture(): { handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const server = { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn) } }
  registerCalendarGoogleHandlers(server as never, {
    platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
  } as never)
  return { handlers }
}

const ctx = { workspaceId: 'ws-1', clientId: 'client-1' }

describe('calendar:google handlers', () => {
  beforeEach(() => {
    credentials.clear()
    authState.configured = false
    authState.exchangeOk = true
  })

  it('reports unavailable with an explicit reason when no OAuth client is configured', async () => {
    const { handlers } = fixture()
    const status = await handlers.get(RPC_CHANNELS.calendar.GOOGLE_STATUS)!(ctx)
    expect(status).toEqual({ provider: 'google', state: 'unavailable', reason: 'no-oauth-client' })
  })

  it('reports disconnected then connected around the OAuth exchange', async () => {
    authState.configured = true
    const { handlers } = fixture()
    const status = handlers.get(RPC_CHANNELS.calendar.GOOGLE_STATUS)!
    const connect = handlers.get(RPC_CHANNELS.calendar.GOOGLE_CONNECT)!

    expect(await status(ctx)).toEqual({ provider: 'google', state: 'disconnected' })

    const prepared = await connect(ctx, { callbackUrl: 'http://localhost:6477/callback' }) as { ok: boolean; authUrl: string; state: string }
    expect(prepared.ok).toBe(true)
    expect(prepared.authUrl).toContain('accounts.google.com')
    expect(prepared.state).toBe('state-1')

    const completed = await connect(ctx, { code: 'auth-code', state: 'state-1' }) as { ok: boolean; email?: string }
    expect(completed).toEqual({ ok: true, email: 'user@example.org' })
    expect(await status(ctx)).toEqual({ provider: 'google', state: 'connected' })
  })

  it('rejects a prepare request without a callback target and refuses unconfigured connects', async () => {
    authState.configured = true
    const { handlers } = fixture()
    const connect = handlers.get(RPC_CHANNELS.calendar.GOOGLE_CONNECT)!
    await expect(connect(ctx, {})).rejects.toThrow(/callbackUrl or callbackPort/)

    authState.configured = false
    expect(await connect(ctx, { callbackUrl: 'http://localhost:6477/callback' }))
      .toEqual({ ok: false, code: 'no-oauth-client', error: 'Google OAuth client is not configured' })
  })

  it('refuses to reuse a prepared flow from another client', async () => {
    authState.configured = true
    const { handlers } = fixture()
    const connect = handlers.get(RPC_CHANNELS.calendar.GOOGLE_CONNECT)!
    await connect(ctx, { callbackUrl: 'http://localhost:6477/callback' })
    const other = await connect({ workspaceId: 'ws-1', clientId: 'intruder' }, { code: 'auth-code', state: 'state-1' }) as { ok: boolean; code: string }
    expect(other.ok).toBe(false)
    expect(other.code).toBe('unknown-flow')
  })

  it('syncs nothing and reports NOT_CONNECTED without a stored token', async () => {
    const { handlers } = fixture()
    const result = await handlers.get(RPC_CHANNELS.calendar.GOOGLE_SYNC)!(ctx) as { ok: boolean; code?: string; total: number }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('CALENDAR_NOT_CONNECTED')
    expect(result.total).toBe(0)
  })

  it('disconnects by deleting the stored credential', async () => {
    authState.configured = true
    const { handlers } = fixture()
    const connect = handlers.get(RPC_CHANNELS.calendar.GOOGLE_CONNECT)!
    await connect(ctx, { callbackUrl: 'http://localhost:6477/callback' })
    await connect(ctx, { code: 'auth-code', state: 'state-1' })

    const disconnected = await handlers.get(RPC_CHANNELS.calendar.GOOGLE_DISCONNECT)!(ctx)
    expect(disconnected).toEqual({ success: true })
    expect(await handlers.get(RPC_CHANNELS.calendar.GOOGLE_STATUS)!(ctx)).toEqual({ provider: 'google', state: 'disconnected' })
  })
})