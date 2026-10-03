import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import { RPC_CHANNELS, PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { deserializeEnvelope } from '../../transport/codec'
import type { HandlerFn, RpcHandlerOptions, RpcServer } from '../../transport/types'
import { isWebThemeId, validWebThemePreferences } from '../appearance-rpc'

const profile = mkdtempSync(join(tmpdir(), 'rox-web-appearance-rpc-'))
const previousConfig = process.env.ROX_CONFIG_DIR
process.env.ROX_CONFIG_DIR = profile
const { WsRpcServer } = await import('../../transport/server')
const { registerWorkspaceCoreHandlers } = await import('../../handlers/rpc/workspace')
const storage = await import('@rox/shared/config/storage')
const { setBundledAssetsRoot } = await import('@rox/shared/utils')
const { createSessionToken, validateSession } = await import('../auth')
const { loadWebPresetTheme, loadWebPresetThemes, readWebDefaultWorkspace } = await import('../theme-storage')
const secret = 'appearance-gate-test-secret-long-enough'
let cookie: string
let workspaceId: string
let foreignId: string
let server: InstanceType<typeof WsRpcServer>
const sockets: WebSocket[] = []
const pushes: Parameters<RpcServer['push']>[] = []
let pendingHandlerPause: { channel: string; entered: () => void; resume: Promise<void> } | null = null

function pauseNextHandler(channel: string) {
  if (pendingHandlerPause) throw new Error('Another appearance handler is already paused')
  let release!: () => void
  let entered!: () => void
  const arrived = new Promise<void>(resolveArrival => { entered = resolveArrival })
  const resume = new Promise<void>(resolveResume => { release = resolveResume })
  pendingHandlerPause = { channel, entered, resume }
  return { arrived, release }
}

const mutatingAppearanceCases: [string, string, () => unknown[]][] = [
  ['global selection', RPC_CHANNELS.theme.SET_COLOR_THEME, () => ['siri-light']],
  ['workspace selection', RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, () => [workspaceId, 'siri-light']],
  ['preference broadcast', RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
    () => [{ mode: 'light', font: 'rox', colorTheme: 'siri-light', contrast: 'normal' }]],
  ['workspace broadcast', RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME, () => [workspaceId, 'siri-light']],
]
const readingAppearanceCases: [string, string, () => unknown[]][] = [
  ['global selection read', RPC_CHANNELS.theme.GET_COLOR_THEME, () => []],
  ['workspace selection read', RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, () => [workspaceId]],
  ['workspace selections read', RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES, () => []],
]

function message(socket: WebSocket, id: string): Promise<MessageEnvelope> {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Test RPC timeout')) }, 5000)
    function listener(data: WebSocket.RawData) {
      const value = deserializeEnvelope(data.toString())
      if (value.id !== id) return
      clearTimeout(timer)
      socket.off('message', listener)
      resolveMessage(value)
    }
    socket.on('message', listener)
  })
}
async function connect(options: { cookie?: string; token?: string; workspaceId?: string; reconnectClientId?: string; lastSeq?: number }) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`, {
    headers: options.cookie ? { Cookie: options.cookie } : undefined,
  })
  sockets.push(socket)
  await once(socket, 'open')
  const id = crypto.randomUUID()
  const response = message(socket, id)
  socket.send(JSON.stringify({ id, type: 'handshake', protocolVersion: PROTOCOL_VERSION,
    workspaceId: options.workspaceId, token: options.token,
    reconnectClientId: options.reconnectClientId, lastSeq: options.lastSeq }))
  return { socket, ack: await response }
}
function request(socket: WebSocket, channel: string, ...args: unknown[]) {
  const id = crypto.randomUUID()
  const response = message(socket, id)
  socket.send(JSON.stringify({ id, type: 'request', channel, args }))
  return response
}

beforeAll(async () => {
  setBundledAssetsRoot(resolve(import.meta.dir, '../../../../../apps/electron'))
  storage.saveConfig(storage.createInitialStoredConfig())
  workspaceId = storage.addWorkspace({ name: 'Appearance A', rootPath: join(profile, 'workspaces', 'a'), kind: 'personal' }).id
  foreignId = storage.addWorkspace({ name: 'Appearance B', rootPath: join(profile, 'workspaces', 'b'), kind: 'personal' }).id
  storage.setActiveWorkspace(workspaceId)
  cookie = `craft_session=${await createSessionToken(secret)}`
  server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true,
    validateToken: async token => token === secret,
    validateSessionCookie: async header => (await validateSession(header, secret)) !== null,
    webUiAppearanceWorkspaceId: () => readWebDefaultWorkspace()?.id ?? null,
  })
  // Use the real handlers and transport, with a deterministic pending-work seam
  // after request admission. Recording push calls also catches an unauthorized
  // broadcast even when the transport subsequently rejects the response.
  const handlerServer = new Proxy(server, {
    get(target, property) {
      if (property === 'handle') return (channel: string, handler: HandlerFn, options?: RpcHandlerOptions) => {
        target.handle(channel, async (ctx, ...args) => {
          const pause = pendingHandlerPause
          if (pause?.channel === channel) {
            pendingHandlerPause = null
            pause.entered()
            await pause.resume
          }
          return handler(ctx, ...args)
        }, options)
      }
      if (property === 'push') return (...args: Parameters<RpcServer['push']>) => {
        pushes.push(args)
        target.push(...args)
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  registerWorkspaceCoreHandlers(handlerServer, { windowManager: {} } as never)
  await server.listen()
})
afterAll(async () => {
  sockets.forEach(socket => socket.terminate())
  await server?.close()
  if (previousConfig === undefined) delete process.env.ROX_CONFIG_DIR
  else process.env.ROX_CONFIG_DIR = previousConfig
  rmSync(profile, { recursive: true, force: true })
})

describe('cookie-authenticated existing appearance RPCs', () => {
  test('allows real config write/readback and only the bound workspace override', async () => {
    const { socket, ack } = await connect({ cookie, workspaceId })
    expect(ack.type).toBe('handshake_ack')
    const presets = await request(socket, RPC_CHANNELS.theme.GET_PRESETS)
    expect(presets.error).toBeUndefined()
    expect((presets.result as any[]).map(preset => preset.id)).toContain('nordfox-opaque')
    expect((presets.result as any[]).every(preset => preset.path === '')).toBe(true)
    const saved = await request(socket, RPC_CHANNELS.theme.SET_COLOR_THEME, 'nordfox-opaque')
    expect(saved.error).toBeUndefined()
    expect((await request(socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).result).toBe('nordfox-opaque')
    expect(storage.loadStoredConfig()?.colorTheme).toBe('nordfox-opaque')
    expect((await request(socket, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, workspaceId, 'siri-light')).error).toBeUndefined()
    expect((await request(socket, RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, workspaceId)).result).toBe('siri-light')
    const all = await request(socket, RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES)
    expect(Object.keys(all.result as object)).toEqual([workspaceId])
    expect((await request(socket, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, workspaceId, null)).error).toBeUndefined()
  })

  test('preserves bearer, desktop-only and unauthenticated denials', async () => {
    const bearer = await connect({ token: secret, workspaceId })
    expect(bearer.ack.type).toBe('handshake_ack')
    expect((await request(bearer.socket, RPC_CHANNELS.theme.SET_COLOR_THEME, 'siri-light')).error?.code).toBe('LOCAL_ONLY_DENIED')
    const web = await connect({ cookie, workspaceId })
    expect((await request(web.socket, RPC_CHANNELS.workspaces.GET)).error?.code).toBe('CHANNEL_NOT_FOUND')
    expect((await request(web.socket, RPC_CHANNELS.workspaces.CREATE, 'unauthorized', '/tmp/never-created')).error?.code).toBe('LOCAL_ONLY_DENIED')
    const unauthenticated = await connect({ workspaceId })
    expect(unauthenticated.ack.error?.code).toBe('AUTH_FAILED')
    const invalidCookie = await connect({ cookie: 'craft_session=invalid', workspaceId })
    expect(invalidCookie.ack.error?.code).toBe('AUTH_FAILED')
  })

  test('rejects unbound and foreign workspace handshakes and request arguments', async () => {
    expect((await connect({ cookie })).ack.error?.code).toBe('AUTH_FAILED')
    expect((await connect({ cookie, workspaceId: foreignId })).ack.error?.code).toBe('AUTH_FAILED')
    const { socket } = await connect({ cookie, workspaceId })
    for (const channel of [RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
      RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME]) {
      const args = channel === RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME ? [foreignId] : [foreignId, 'siri-light']
      expect((await request(socket, channel, ...args)).error?.code).toBe('INVALID_PAYLOAD')
    }
    expect((await request(socket, RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
      { mode: 'dark', font: 'inter', colorTheme: 'siri-light', contrast: 'high' })).error).toBeUndefined()
  })

  test('bearer reconnect never inherits the cookie appearance grant', async () => {
    const web = await connect({ cookie, workspaceId })
    expect((await request(web.socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).error).toBeUndefined()
    const closed = once(web.socket, 'close')
    web.socket.close()
    await closed
    const bearer = await connect({ token: secret, workspaceId,
      reconnectClientId: web.ack.clientId, lastSeq: 0 })
    expect(bearer.ack.type).toBe('handshake_ack')
    expect(bearer.ack.clientId).not.toBe(web.ack.clientId)
    expect((await request(bearer.socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).error?.code).toBe('LOCAL_ONLY_DENIED')
  })

  test('rejects traversal, generic JSON, symlinks, unknown themes and invalid preference fields', async () => {
    const { socket } = await connect({ cookie, workspaceId })
    for (const id of ['../config', 'a/b', 'a\\b', '.', '..', '\0', '', 'a'.repeat(251)]) {
      expect(isWebThemeId(id)).toBe(false)
      expect((await request(socket, RPC_CHANNELS.theme.LOAD_PRESET, id)).error?.code).toBe('INVALID_PAYLOAD')
    }
    mkdirSync(storage.getAppThemesDir(), { recursive: true })
    writeFileSync(join(storage.getAppThemesDir(), 'private-data.json'), JSON.stringify({ token: 'private fixture bytes' }))
    symlinkSync(join(storage.getAppThemesDir(), 'siri-light.json'), join(storage.getAppThemesDir(), 'linked-theme.json'))
    expect(loadWebPresetTheme('private-data')).toBeNull()
    expect(loadWebPresetTheme('linked-theme')).toBeNull()
    expect(loadWebPresetThemes().some(preset => ['private-data', 'linked-theme'].includes(preset.id))).toBe(false)
    expect((await request(socket, RPC_CHANNELS.theme.SET_COLOR_THEME, 'missing-theme')).error?.code).toBe('INVALID_PAYLOAD')
    for (const preferences of [
      { mode: 'arbitrary', colorTheme: 'siri-light', font: 'inter' },
      { mode: ['system'], colorTheme: 'siri-light', font: 'inter' },
      { mode: 'dark', colorTheme: '../config', font: 'inter' },
      { mode: 'dark', colorTheme: 'siri-light', font: 'arbitrary' },
      { mode: 'dark', colorTheme: 'siri-light', font: 'inter', contrast: 'arbitrary' },
    ]) {
      expect(validWebThemePreferences(preferences)).toBe(false)
      expect((await request(socket, RPC_CHANNELS.theme.BROADCAST_PREFERENCES, preferences)).error?.code).toBe('INVALID_PAYLOAD')
    }
  })


  test('preserves custom IDs containing spaces, dots and Unicode', async () => {
    const customId = 'My theme.v2 Светлая'
    expect(isWebThemeId(customId)).toBe(true)
    writeFileSync(join(storage.getAppThemesDir(), `${customId}.json`),
      readFileSync(join(storage.getAppThemesDir(), 'siri-light.json'), 'utf8'))
    const { socket } = await connect({ cookie, workspaceId })
    expect((await request(socket, RPC_CHANNELS.theme.LOAD_PRESET, customId)).error).toBeUndefined()
    expect((await request(socket, RPC_CHANNELS.theme.SET_COLOR_THEME, customId)).error).toBeUndefined()
    expect((await request(socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).result).toBe(customId)
    expect((await request(socket, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, workspaceId, customId)).error).toBeUndefined()
    expect((await request(socket, RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, workspaceId)).result).toBe(customId)
    await request(socket, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, workspaceId, null)
  })

  test('missing or corrupt config/workspace never acknowledges a theme write', async () => {
    const { socket } = await connect({ cookie, workspaceId })
    const workspacePath = storage.getWorkspaces().find(workspace => workspace.id === workspaceId)!.rootPath
    const workspaceConfig = join(workspacePath, 'config.json')
    const globalConfig = storage.getConfigPath()
    for (const path of [workspaceConfig, globalConfig]) {
      const original = readFileSync(path, 'utf8')
      renameSync(path, `${path}.saved`)
      try {
        const channel = path === workspaceConfig ? RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME : RPC_CHANNELS.theme.SET_COLOR_THEME
        const args = path === workspaceConfig ? [workspaceId, 'siri-light'] : ['siri-light']
        expect((await request(socket, channel, ...args)).error).toBeDefined()
        writeFileSync(path, '{corrupt appearance test config')
        expect((await request(socket, channel, ...args)).error).toBeDefined()
        expect(readFileSync(path, 'utf8')).toBe('{corrupt appearance test config')
      } finally {
        writeFileSync(path, original)
        rmSync(`${path}.saved`)
      }
    }
  })

  test('withdraws appearance access when server default workspace changes', async () => {
    const { socket } = await connect({ cookie, workspaceId })
    storage.setActiveWorkspace(foreignId)
    expect((await request(socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).error?.code).toBe('LOCAL_ONLY_DENIED')
    storage.setActiveWorkspace(workspaceId)
    expect((await request(socket, RPC_CHANNELS.theme.GET_COLOR_THEME)).error).toBeUndefined()
  })

  test.each([...mutatingAppearanceCases, ...readingAppearanceCases])('withdrawal during pending %s causes no write or broadcast', async (_label, channel, args) => {
    storage.setColorTheme('nordfox-opaque')
    const { socket } = await connect({ cookie, workspaceId })
    const workspaceConfig = join(storage.getWorkspaces().find(workspace => workspace.id === workspaceId)!.rootPath, 'config.json')
    const pause = pauseNextHandler(channel)
    const response = request(socket, channel, ...args())
    try {
      await pause.arrived
      storage.setActiveWorkspace(foreignId)
      const withdrawnGlobalBytes = readFileSync(storage.getConfigPath(), 'utf8')
      const withdrawnWorkspaceBytes = readFileSync(workspaceConfig, 'utf8')
      const pushCount = pushes.length
      pause.release()
      expect((await response).error?.code).toBe('AUTH_FAILED')
      expect(readFileSync(storage.getConfigPath(), 'utf8')).toBe(withdrawnGlobalBytes)
      expect(readFileSync(workspaceConfig, 'utf8')).toBe(withdrawnWorkspaceBytes)
      expect(pushes).toHaveLength(pushCount)
    } finally {
      pause.release()
      storage.setActiveWorkspace(workspaceId)
    }
  })

  test('unchanged workspace grant permits all pending mutations and scoped broadcasts', async () => {
    const { socket } = await connect({ cookie, workspaceId })
    const pushCount = pushes.length
    for (const [, channel, args] of mutatingAppearanceCases) {
      const pause = pauseNextHandler(channel)
      const response = request(socket, channel, ...args())
      try {
        await pause.arrived
        pause.release()
        expect((await response).error).toBeUndefined()
      } finally {
        pause.release()
      }
    }
    expect(storage.loadStoredConfig()?.colorTheme).toBe('siri-light')
    expect((await request(socket, RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, workspaceId)).result).toBe('siri-light')
    expect(pushes.slice(pushCount).map(([channel, target]) => ({ channel, target }))).toEqual([
      { channel: RPC_CHANNELS.theme.PREFERENCES_CHANGED, target: { to: 'workspace', workspaceId } },
      { channel: RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, target: { to: 'workspace', workspaceId } },
    ])
  })
})
