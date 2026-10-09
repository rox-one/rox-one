/**
 * Telegram account-linking RPC surface (owner spec R4).
 *
 * The desktop dialog never talks HTTP directly: the renderer asks the local
 * server on `tg-link:start | verify | status`, and this handler forwards to the
 * rox-tg-linkd daemon. The remote default is `https://rox.one`, whose website
 * proxy forwards `/api/link/*` to the platform daemon (the desktop cannot reach
 * the daemon's loopback). A local daemon is opt-in via
 * `ROX_TG_LINK_URL=http://127.0.0.1:8095` (see services/rox-tg-linkd). The Rox
 * user id is resolved from the Rox account authority — an unauthenticated
 * caller gets an honest `unavailable` instead of a link bound to nobody.
 */
import { getRoxAccountAuthority, LOCAL_ROX_CALLER } from '@rox/shared/auth'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const DEFAULT_TG_LINK_URL = 'https://rox.one'

/** UI-facing state machine shared with the renderer hook. */
export type TgLinkUiStatus = 'idle' | 'waiting-code' | 'code-sent' | 'linked' | 'expired' | 'unavailable'

export interface TgLinkStartResult {
  ok: boolean
  status: TgLinkUiStatus
  /** Opaque pairing id (the service token); the renderer bridge addresses the link by it. */
  linkId?: string
  code?: string
  deepLink?: string
  tgDeepLink?: string
  expiresAt?: number
  remainingMs?: number
  error?: string
}

export interface TgLinkVerifyResult {
  ok: boolean
  status: 'linked' | 'expired' | 'invalid' | 'unavailable'
  error?: string
}

export interface TgLinkStatusResult {
  ok: boolean
  status: TgLinkUiStatus
  expiresAt?: number | null
  remainingMs?: number
  /** Auto-returned code once the phone is shared (the dialog pre-fills it). */
  code?: string
  error?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface TelegramLinkServiceConfig {
  baseUrl: string
  authToken: string
  timeoutMs: number
  fetchImpl?: FetchLike
}

let serviceConfig: TelegramLinkServiceConfig | null = null

function envConfig(): TelegramLinkServiceConfig {
  return {
    baseUrl: (process.env.ROX_TG_LINK_URL ?? '').trim() || DEFAULT_TG_LINK_URL,
    authToken: (process.env.ROX_TG_LINK_TOKEN ?? process.env.LINK_AUTH_TOKEN ?? '').trim(),
    timeoutMs: 8000,
  }
}

/**
 * Wire the local daemon endpoint. Called once by the Electron main process
 * (`registerTelegramLink`); headless servers fall back to the environment.
 */
export function configureTelegramLinkService(config: Partial<TelegramLinkServiceConfig>): void {
  serviceConfig = { ...(serviceConfig ?? envConfig()), ...config }
}

function currentConfig(): TelegramLinkServiceConfig {
  if (!serviceConfig) serviceConfig = envConfig()
  return serviceConfig
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.tgLink.START,
  RPC_CHANNELS.tgLink.VERIFY,
  RPC_CHANNELS.tgLink.STATUS,
] as const

/** Rox account id used to key the link; null when no account is connected. */
async function resolveRoxUserId(ctx: { principal?: { issuer?: string; subject?: string } }): Promise<string | null> {
  try {
    const caller = ctx.principal?.subject ? { issuer: ctx.principal.issuer ?? '', subject: ctx.principal.subject } : LOCAL_ROX_CALLER
    const state = await getRoxAccountAuthority().state(caller)
    return state.account?.user?.id ?? null
  } catch {
    return null
  }
}

const UNAVAILABLE = (error: string, status: TgLinkUiStatus = 'unavailable') => ({ ok: false as const, status, error })

async function callService<T>(path: string, init: RequestInit): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const config = currentConfig()
  const fetchImpl: FetchLike = config.fetchImpl ?? ((input, requestInit) => fetch(input, requestInit))
  let response: Response
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(config.authToken ? { authorization: `Bearer ${config.authToken}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch {
    return { ok: false, error: 'SERVICE_UNREACHABLE' }
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) {
    if (response.status === 401) return { ok: false, error: 'SERVICE_UNAUTHORIZED' }
    if (response.status === 503) return { ok: false, error: body?.error === 'no_bot_username' ? 'NO_BOT_USERNAME' : 'NO_BOT_TOKEN' }
    return { ok: false, error: 'SERVICE_ERROR' }
  }
  if (!body) return { ok: false, error: 'SERVICE_ERROR' }
  return { ok: true, body }
}

const SERVICE_STATUS: Record<string, TgLinkUiStatus> = {
  none: 'idle',
  'waiting-code': 'waiting-code',
  'code-sent': 'code-sent',
  linked: 'linked',
  expired: 'expired',
}

function uiStatus(raw: unknown): TgLinkUiStatus {
  return typeof raw === 'string' && raw in SERVICE_STATUS ? SERVICE_STATUS[raw]! : 'unavailable'
}

export function registerTgLinkHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(
    RPC_CHANNELS.tgLink.START,
    async ctx => {
      const roxUserId = await resolveRoxUserId(ctx)
      if (!roxUserId) return UNAVAILABLE('ROX_ACCOUNT_NOT_CONNECTED')
      const result = await callService<{ status?: string; linkId?: string; code?: string; deepLink?: string; tgDeepLink?: string; expiresAt?: number; remainingMs?: number }>(
        '/api/link/start',
        { method: 'POST', body: JSON.stringify({ roxUserId }) },
      )
      if (!result.ok) return UNAVAILABLE(result.error)
      const body = result.body
      return {
        ok: true,
        status: uiStatus(body.status),
        ...(body.linkId ? { linkId: body.linkId } : {}),
        ...(body.code ? { code: body.code } : {}),
        ...(body.deepLink ? { deepLink: body.deepLink } : {}),
        ...(body.tgDeepLink ? { tgDeepLink: body.tgDeepLink } : {}),
        ...(typeof body.expiresAt === 'number' ? { expiresAt: body.expiresAt } : {}),
        ...(typeof body.remainingMs === 'number' ? { remainingMs: body.remainingMs } : {}),
      } satisfies TgLinkStartResult
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.tgLink.VERIFY,
    async (ctx, code: unknown) => {
      if (typeof code !== 'string' || code.trim() === '') return { ok: false, status: 'invalid', error: 'INVALID_CODE' } satisfies TgLinkVerifyResult
      const roxUserId = await resolveRoxUserId(ctx)
      if (!roxUserId) return UNAVAILABLE('ROX_ACCOUNT_NOT_CONNECTED') as TgLinkVerifyResult
      const result = await callService<{ status?: string }>('/api/link/verify', {
        method: 'POST',
        body: JSON.stringify({ roxUserId, code }),
      })
      if (!result.ok) return UNAVAILABLE(result.error) as TgLinkVerifyResult
      const status = result.body.status
      return {
        ok: true,
        status: status === 'linked' || status === 'expired' || status === 'invalid' ? status : 'invalid',
      } satisfies TgLinkVerifyResult
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.tgLink.STATUS,
    async ctx => {
      const roxUserId = await resolveRoxUserId(ctx)
      if (!roxUserId) return UNAVAILABLE('ROX_ACCOUNT_NOT_CONNECTED') as TgLinkStatusResult
      const result = await callService<{ status?: string; expiresAt?: number | null; remainingMs?: number; code?: string }>(
        `/api/link/status?roxUserId=${encodeURIComponent(roxUserId)}`,
        { method: 'GET' },
      )
      if (!result.ok) return UNAVAILABLE(result.error) as TgLinkStatusResult
      return {
        ok: true,
        status: uiStatus(result.body.status),
        expiresAt: result.body.expiresAt ?? null,
        remainingMs: typeof result.body.remainingMs === 'number' ? result.body.remainingMs : 0,
        ...(result.body.code ? { code: result.body.code } : {}),
      } satisfies TgLinkStatusResult
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'read' },
  )
}