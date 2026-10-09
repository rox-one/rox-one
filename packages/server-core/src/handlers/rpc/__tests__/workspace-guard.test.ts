import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { assertWorkspaceScope } from '../workspace-guard.ts'
import { registerFeedHandlers } from '../feed.ts'

const actor = (workspaceId: string): RequestContext['actor'] => ({
  principalId: 'p',
  deviceId: 'd',
  sessionId: 's',
  authenticatedWorkspaceIds: [workspaceId],
  expiresAt: 0,
})

const contexts: Array<[string, RequestContext]> = [
  ['native principal', { clientId: 'c', workspaceId: 'ws', webContentsId: null, principal: { credentialId: 'cred' } as never }],
  ['shared-workspace actor', { clientId: 'c', workspaceId: 'ws', webContentsId: null, actor: actor('ws') }],
  ['web ui session', { clientId: 'c', workspaceId: 'ws', webContentsId: null, webUiAuthenticated: true }],
]

describe('assertWorkspaceScope', () => {
  it('denies a foreign workspace for every authenticated identity kind', () => {
    for (const ctx of contexts.map(([, value]) => value)) {
      expect(() => assertWorkspaceScope(ctx, 'other', 'x')).toThrow('x')
      expect(() => assertWorkspaceScope(ctx, 'ws', 'x')).not.toThrow()
    }
  })

  it('is a no-op for a local client with no bound identity', () => {
    const local: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: null }
    expect(() => assertWorkspaceScope(local, 'other', 'x')).not.toThrow()
  })

  it("can be narrowed to a native principal for cross-workspace reads", () => {
    const shared: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: null, actor: actor('ws') }
    expect(() => assertWorkspaceScope(shared, 'other', 'x', 'principal')).not.toThrow()
    const native: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: null, principal: { credentialId: 'cred' } as never }
    expect(() => assertWorkspaceScope(native, 'other', 'x', 'principal')).toThrow('x')
  })
})

describe('feed:list SEC-03 workspace scope', () => {
  it('denies a foreign workspace for a shared-workspace client', async () => {
    const handlers = new Map<string, HandlerFn>()
    const server = {
      handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
      push() {},
      onShutdown() { return () => {} },
    } as unknown as RpcServer
    const deps = {
      platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
      sessionManager: { getSessions: () => [] },
    } as unknown as HandlerDeps
    registerFeedHandlers(server, deps, {})
    const list = handlers.get(RPC_CHANNELS.feed.LIST)!
    const shared: RequestContext = { clientId: 'c', workspaceId: 'ws', webContentsId: null, actor: actor('ws') }
    await expect(Promise.resolve(list(shared, 'other'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})