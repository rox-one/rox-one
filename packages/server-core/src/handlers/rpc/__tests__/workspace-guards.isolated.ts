import { describe, expect, it, mock } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../../transport/types'
import type { HandlerDeps } from '../../handler-deps'

// Run in its own Bun process: onboarding tests also provide a config module seam.
mock.module('@craft-agent/shared/config', () => ({ getWorkspaceByNameOrId: () => null }))
const { registerLabelsHandlers } = await import('../labels')
const { registerMessagingHandlers } = await import('../messaging')

function harness() {
  const handlers = new Map<string, HandlerFn>()
  const pushes: string[] = []
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler) },
    push(channel) { pushes.push(channel) },
    async invokeClient() { return undefined },
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const invoke = (channel: string, workspaceId: string | null, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Missing handler: ${channel}`)
    const context: RequestContext = { clientId: 'test-client', workspaceId, webContentsId: null }
    return handler(context, ...args)
  }
  return { server, pushes, invoke }
}

describe('workspace guards on merged RPC gates', () => {
  it('rejects a missing label workspace before attempting deletion or broadcasting changes', async () => {
    const { server, invoke, pushes } = harness()
    registerLabelsHandlers(server, {} as HandlerDeps)
    await expect(invoke(RPC_CHANNELS.labels.DELETE, 'missing', 'missing', 'label-1')).rejects.toThrow('Workspace not found')
    expect(pushes).toEqual([])
  })

  it('rejects missing messaging workspace before reading any bindings', async () => {
    const { server, invoke } = harness()
    const reads: string[] = []
    const deps = { messagingRegistry: { getBindings(workspaceId: string) { reads.push(workspaceId); return [] } } } as unknown as HandlerDeps
    registerMessagingHandlers(server, deps)
    await expect(invoke(RPC_CHANNELS.messaging.GET_BINDINGS, null)).rejects.toThrow('Missing workspaceId')
    expect(reads).toEqual([])
  })

  it('reads bindings from the exact authenticated workspace after the gate succeeds', async () => {
    const { server, invoke } = harness()
    const reads: string[] = []
    const deps = { messagingRegistry: { getBindings(workspaceId: string) { reads.push(workspaceId); return [] } } } as unknown as HandlerDeps
    registerMessagingHandlers(server, deps)
    expect(await invoke(RPC_CHANNELS.messaging.GET_BINDINGS, 'workspace-a')).toEqual([])
    expect(reads).toEqual(['workspace-a'])
  })
})
