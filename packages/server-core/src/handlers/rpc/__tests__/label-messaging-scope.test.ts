import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../../transport/types.ts'
import type { HandlerDeps } from '../../handler-deps.ts'
import { registerLabelsHandlers } from '../labels.ts'
import { registerMessagingHandlers } from '../messaging.ts'

function harness() {
  const handlers = new Map<string, HandlerFn>()
  let pushes = 0
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push: () => { pushes++ },
    invokeClient: async () => undefined,
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  return { server, handlers, pushes: () => pushes }
}

const context: RequestContext = { clientId: 'test-client', workspaceId: null, webContentsId: null }

describe('label and messaging RPC workspace guards', () => {
  it('refuses label deletion without a workspace before writing or publishing', async () => {
    const { server, handlers, pushes } = harness()
    registerLabelsHandlers(server, {} as HandlerDeps)
    const remove = handlers.get(RPC_CHANNELS.labels.DELETE)!
    await expect(remove(context, '', 'label-1')).rejects.toThrow('Workspace not found')
    expect(pushes()).toBe(0)
  })

  it('refuses missing messaging scope and forwards valid scope exactly once', async () => {
    const { server, handlers } = harness()
    const requestedWorkspaces: string[] = []
    const deps = {
      messagingRegistry: {
        getBindings: (workspaceId: string) => { requestedWorkspaces.push(workspaceId); return [] },
      },
    } as unknown as HandlerDeps
    registerMessagingHandlers(server, deps)
    const bindings = handlers.get(RPC_CHANNELS.messaging.GET_BINDINGS)!
    await expect(bindings(context)).rejects.toThrow('Missing workspaceId')
    expect(requestedWorkspaces).toEqual([])
    await expect(bindings({ ...context, workspaceId: 'workspace-1' })).resolves.toEqual([])
    expect(requestedWorkspaces).toEqual(['workspace-1'])
  })
})
