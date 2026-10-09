import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { ThemeOverrides } from '@rox/shared/config'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

// In-memory stand-in for the app theme override file (theme.json) so the
// handler's dynamic `@rox/shared/config/storage` import stays side-effect free.
let storedTheme: ThemeOverrides | null = null

function savedTheme(): ThemeOverrides {
  if (storedTheme === null) throw new Error('expected a saved theme')
  return storedTheme
}

function errorCode(error: unknown): unknown {
  if (error && typeof error === 'object' && 'code' in error) return error.code
  return undefined
}

// In-memory stand-in for the app theme override file (theme.json); keep every
// other real export since the `@rox/shared/config` barrel re-exports storage.
const realStorage = await import('@rox/shared/config/storage')
mock.module('@rox/shared/config/storage', () => ({
  ...realStorage,
  loadAppTheme: () => storedTheme,
  saveAppTheme: (theme: ThemeOverrides) => {
    storedTheme = theme
  },
}))

// Keep every real export (theme-storage imports `expandPath`); stub only perf.
const realUtils = await import('@rox/shared/utils')
mock.module('@rox/shared/utils', () => ({
  ...realUtils,
  perf: { start: () => () => {} },
}))

mock.module('@rox/server-core/transport', () => ({
  pushTyped: (
    server: { push: (channel: string, target: unknown, ...args: unknown[]) => void },
    channel: string,
    target: unknown,
    ...args: unknown[]
  ) => {
    server.push(channel, target, ...args)
  },
}))

type Handler = (
  ctx: { clientId: string; workspaceId?: string; webContentsId: number | null; webUiAuthenticated?: boolean },
  ...args: unknown[]
) => unknown | Promise<unknown>

async function registerHandlers(): Promise<Map<string, Handler>> {
  const { registerWorkspaceCoreHandlers } = await import('../workspace')
  // Handler registry: dynamic channel → handler insertion, so a Map is the fit.
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
    push() {},
  } as unknown as RpcServer
  const deps = {
    sessionManager: { getWorkspaces: () => [] },
    windowManager: {},
    platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
  } as unknown as HandlerDeps
  registerWorkspaceCoreHandlers(server, deps)
  return handlers
}

const localCtx = { clientId: 'client-1', webContentsId: 1 }

describe('theme:setAppMaterial', () => {
  beforeEach(() => {
    storedTheme = null
  })

  it('registers the LOCAL_ONLY channel', async () => {
    const handlers = await registerHandlers()
    expect(handlers.has(RPC_CHANNELS.theme.SET_APP_MATERIAL)).toBe(true)
  })

  it('saves validated material into theme.json and preserves other fields', async () => {
    storedTheme = { mode: 'solid', background: '#101010', dark: { foreground: '#ffffff' } }
    const handlers = await registerHandlers()
    const handler = handlers.get(RPC_CHANNELS.theme.SET_APP_MATERIAL)!

    const material = { enabled: true, blur: { chat: 10, topbar: 24 }, opacity: { chat: 0.6 } }
    const expected: ThemeOverrides = {
      mode: 'solid',
      background: '#101010',
      dark: { foreground: '#ffffff' },
      material,
    }
    const result = await handler(localCtx, material)

    expect(result).toEqual(expected)
    expect(savedTheme()).toEqual(expected)
    expect(savedTheme().material).toEqual(material)
    expect(savedTheme().background).toBe('#101010')
  })

  it('creates the override file when none exists', async () => {
    const handlers = await registerHandlers()
    const handler = handlers.get(RPC_CHANNELS.theme.SET_APP_MATERIAL)!

    const result = await handler(localCtx, { enabled: true })

    expect(result).toEqual({ material: { enabled: true } })
    expect(savedTheme()).toEqual({ material: { enabled: true } })
  })

  it('null clears the material field while preserving the rest', async () => {
    storedTheme = { mode: 'scenic', backgroundImage: 'https://example.test/bg.png', material: { enabled: true } }
    const handlers = await registerHandlers()
    const handler = handlers.get(RPC_CHANNELS.theme.SET_APP_MATERIAL)!

    const result = await handler(localCtx, null)

    expect(result).toEqual({ mode: 'scenic', backgroundImage: 'https://example.test/bg.png' })
    expect(savedTheme().material).toBeUndefined()
    expect(savedTheme().mode).toBe('scenic')
  })

  it('rejects invalid payloads without writing', async () => {
    storedTheme = { mode: 'solid', material: { enabled: true } }
    const before = JSON.stringify(storedTheme)
    const handlers = await registerHandlers()
    const handler = handlers.get(RPC_CHANNELS.theme.SET_APP_MATERIAL)!

    for (const bad of [
      { enabled: 'yes' },
      { blur: { chat: 200 } },       // out of range
      { blur: { unknown: 4 } },      // unknown surface
      'not-an-object',
      42,
    ]) {
      let code: unknown
      try {
        await handler(localCtx, bad)
      } catch (error) {
        code = errorCode(error)
      }
      expect(code).toBe('INVALID_PAYLOAD')
    }
    expect(JSON.stringify(storedTheme)).toBe(before)
  })

  it('denies web-authenticated contexts (LOCAL_ONLY)', async () => {
    storedTheme = { mode: 'solid' }
    const handlers = await registerHandlers()
    const handler = handlers.get(RPC_CHANNELS.theme.SET_APP_MATERIAL)!

    let code: unknown
    try {
      await handler({ ...localCtx, webUiAuthenticated: true }, { enabled: true })
    } catch (error) {
      code = errorCode(error)
    }
    expect(code).toBe('AUTH_FAILED')
    expect(savedTheme().material).toBeUndefined()
  })
})