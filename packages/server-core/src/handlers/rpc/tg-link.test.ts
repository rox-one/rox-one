import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { peekRoxAccountAuthority, setRoxAccountAuthority, type RoxAccountAuthority } from '@rox/shared/auth'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import { configureTelegramLinkService, registerTgLinkHandlers, type FetchLike } from './tg-link'

/**
 * R4: the tg-link RPC surface forwards to the local rox-tg-linkd daemon and
 * resolves the Rox account id itself. These tests stub both seams and pin the
 * honest-negative mapping (unreachable / unconfigured / no account).
 */

let restoreAuthority: RoxAccountAuthority | undefined

beforeEach(() => {
  restoreAuthority = peekRoxAccountAuthority()
})

afterEach(() => {
  if (restoreAuthority) setRoxAccountAuthority(restoreAuthority)
})

function stubAccount(id: string | null): void {
  setRoxAccountAuthority({
    state: async () => ({ connected: id !== null, account: id === null ? null : { user: { id } } }),
  } as unknown as RoxAccountAuthority)
}

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push() {}, async invokeClient() {}, hasClientCapability() { return false },
    findClientsWithCapability() { return [] }, isRequestContextCurrent() { return true },
  } as unknown as RpcServer
  registerTgLinkHandlers(server, { platform: { logger: { error() {}, warn() {}, info() {}, debug() {} } } } as unknown as HandlerDeps)
  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`channel not registered: ${channel}`)
    return handler(context, ...args)
  }
  return { handlers, invoke }
}

const context: RequestContext = { clientId: 'client', workspaceId: 'workspace', webContentsId: null }

function serviceResponse(routes: Record<string, () => Response | Promise<Response>>): FetchLike {
  return async (input: string) => {
    const path = new URL(input).pathname
    const route = routes[path]
    if (!route) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
    return route()
  }
}

function channel(tgLink: { START: string; VERIFY: string; STATUS: string }) {
  return { start: tgLink.START, verify: tgLink.VERIFY, status: tgLink.STATUS }
}

const C = channel(RPC_CHANNELS.tgLink)

describe('tg-link RPC handlers', () => {
  test('maps the service start payload and preserves both deep links', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: serviceResponse({
        '/api/link/start': () => new Response(JSON.stringify({
          ok: true,
          status: 'waiting-code',
          linkId: 'tkn-1',
          code: 'ABCD2345',
          deepLink: 'https://t.me/rox_bot?start=t',
          tgDeepLink: 'tg://resolve?domain=rox_bot&start=t',
          expiresAt: 1_700_000_000_000,
          remainingMs: 1_800_000,
        }), { status: 200 }),
      }),
    })
    const { invoke } = harness()
    expect(await invoke(C.start)).toEqual({
      ok: true,
      status: 'waiting-code',
      linkId: 'tkn-1',
      code: 'ABCD2345',
      deepLink: 'https://t.me/rox_bot?start=t',
      tgDeepLink: 'tg://resolve?domain=rox_bot&start=t',
      expiresAt: 1_700_000_000_000,
      remainingMs: 1_800_000,
    })
  })

  test('maps verify results and reports invalid shapes as invalid', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: serviceResponse({
        '/api/link/verify': () => new Response(JSON.stringify({ ok: true, status: 'linked' }), { status: 200 }),
      }),
    })
    const { invoke } = harness()
    expect(await invoke(C.verify, 'abcd-2345')).toEqual({ ok: true, status: 'linked' })
    expect(await invoke(C.verify, '')).toEqual({ ok: false, status: 'invalid', error: 'INVALID_CODE' })
  })

  test('maps the service "none" status to idle', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: serviceResponse({
        '/api/link/status': () => new Response(JSON.stringify({ ok: true, status: 'none', expiresAt: null, remainingMs: 0 }), { status: 200 }),
      }),
    })
    const { invoke } = harness()
    expect(await invoke(C.status)).toEqual({ ok: true, status: 'idle', expiresAt: null, remainingMs: 0 })
  })

  test('passes the issued code through the status channel', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: serviceResponse({
        '/api/link/status': () => new Response(
          JSON.stringify({ ok: true, status: 'code-sent', expiresAt: 1_700_000_000_000, remainingMs: 1_000, code: 'ABCD2345' }),
          { status: 200 },
        ),
      }),
    })
    const { invoke } = harness()
    expect(await invoke(C.status)).toEqual({
      ok: true,
      status: 'code-sent',
      expiresAt: 1_700_000_000_000,
      remainingMs: 1_000,
      code: 'ABCD2345',
    })
  })

  test('is honestly unavailable when the daemon cannot be reached', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: async () => { throw new Error('ECONNREFUSED') },
    })
    const { invoke } = harness()
    expect(await invoke(C.start)).toEqual({ ok: false, status: 'unavailable', error: 'SERVICE_UNREACHABLE' })
    expect(await invoke(C.status)).toEqual({ ok: false, status: 'unavailable', error: 'SERVICE_UNREACHABLE' })
  })

  test('surfaces a missing bot token as unavailable, not success', async () => {
    stubAccount('user-1')
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: serviceResponse({
        '/api/link/start': () => new Response(JSON.stringify({ error: 'no_bot_token' }), { status: 503 }),
      }),
    })
    const { invoke } = harness()
    expect(await invoke(C.start)).toEqual({ ok: false, status: 'unavailable', error: 'NO_BOT_TOKEN' })
  })

  test('refuses without a connected Rox account', async () => {
    stubAccount(null)
    configureTelegramLinkService({
      baseUrl: 'http://127.0.0.1:8095',
      authToken: '',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, status: 'waiting-code' }), { status: 200 }),
    })
    const { invoke } = harness()
    expect(await invoke(C.start)).toEqual({ ok: false, status: 'unavailable', error: 'ROX_ACCOUNT_NOT_CONNECTED' })
    expect(await invoke(C.verify, 'ABCD2345')).toEqual({ ok: false, status: 'unavailable', error: 'ROX_ACCOUNT_NOT_CONNECTED' })
  })
})