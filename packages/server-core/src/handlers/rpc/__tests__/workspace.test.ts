import { afterAll, describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'

const activeRemoteWorkspace = {
  id: 'ws-remote',
  name: 'Remote',
  slug: 'remote',
  rootPath: '/workspaces/remote',
  createdAt: 1,
  updatedAt: 1,
  kind: 'personal' as const,
  remoteServer: { url: 'wss://remote.example.test', token: 'test-token' },
}

const localWorkspace = {
  id: 'ws-local',
  name: 'Local',
  slug: 'local',
  rootPath: '/workspaces/local',
  createdAt: 1,
  updatedAt: 1,
  kind: 'personal' as const,
}

const actualConfig = await import('@rox/shared/config')
mock.module('@rox/shared/config', () => ({
  ...actualConfig,
  addWorkspace: () => localWorkspace,
  createAndActivateLocalWorkspace: async () => ({
    workspace: localWorkspace,
    activeWorkspaceId: localWorkspace.id,
    session: { id: 'session', createdAt: 1, lastUsedAt: 1 },
  }),
  getActiveWorkspace: () => activeRemoteWorkspace,
  getWorkspaceByNameOrId: () => null,
  setActiveWorkspace: () => {},
  updateWorkspaceRemoteServer: () => {},
}))

const actualConfigPaths = await import('@rox/shared/config/paths')
mock.module('@rox/shared/config/paths', () => ({
  ...actualConfigPaths,
  CONFIG_DIR: '/config',
}))

const actualUtils = await import('@rox/shared/utils')
mock.module('@rox/shared/utils', () => ({
  ...actualUtils,
  perf: { start: () => () => {} },
}))

const actualTransport = await import('@rox/server-core/transport')
mock.module('@rox/server-core/transport', () => ({
  ...actualTransport,
  pushTyped: (
    server: { push: (channel: string, target: unknown, ...args: unknown[]) => void },
    channel: string,
    target: unknown,
    ...args: unknown[]
  ) => {
    server.push(channel, target, ...args)
  },
}))
afterAll(() => {
  mock.module('@rox/shared/config', () => actualConfig)
  mock.module('@rox/shared/config/paths', () => actualConfigPaths)
  mock.module('@rox/shared/utils', () => actualUtils)
  mock.module('@rox/server-core/transport', () => actualTransport)
})

type Handler = (
  ctx: { clientId: string; workspaceId?: string; webContentsId: number | null },
  ...args: unknown[]
) => unknown | Promise<unknown>

describe('window:getWorkspace', () => {
  it('binds an unmapped window to the available local workspace before remote fallback', async () => {
    const { registerWorkspaceCoreHandlers } = await import('../workspace')
    const handlers = new Map<string, Handler>()
    const watcherCalls: Array<[string, string]> = []
    const clientWorkspaceUpdates: Array<[string, string]> = []
    const windowWorkspaceUpdates: Array<[number, string]> = []
    const server = {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler)
      },
      updateClientWorkspace(clientId: string, workspaceId: string) {
        clientWorkspaceUpdates.push([clientId, workspaceId])
      },
    } as unknown as RpcServer
    const deps = {
      sessionManager: {
        getWorkspaces: () => [localWorkspace],
        setupConfigWatcher(rootPath: string, workspaceId: string) {
          watcherCalls.push([rootPath, workspaceId])
        },
      },
      windowManager: {
        getWorkspaceForWindow: () => undefined,
        updateWindowWorkspace(webContentsId: number, workspaceId: string) {
          windowWorkspaceUpdates.push([webContentsId, workspaceId])
          return true
        },
      },
      platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } },
    } as unknown as HandlerDeps

    registerWorkspaceCoreHandlers(server, deps)
    const handler = handlers.get(RPC_CHANNELS.window.GET_WORKSPACE)
    if (!handler) throw new Error('window:getWorkspace handler was not registered')

    const workspaceId = await handler({
      clientId: 'client-1',
      webContentsId: 42,
    })

    expect(workspaceId).toBe(localWorkspace.id)
    expect(watcherCalls).toEqual([[localWorkspace.rootPath, localWorkspace.id]])
    expect(windowWorkspaceUpdates).toEqual([[42, localWorkspace.id]])
    expect(clientWorkspaceUpdates).toEqual([['client-1', localWorkspace.id]])
  })
})
