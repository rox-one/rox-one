import { describe, expect, it } from 'bun:test'
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../../handler-deps'
import { NodeRegistry } from '../../../nodes/index.ts'
import { registerNodeHandlers } from '../nodes.ts'

interface Push { channel: string; target: unknown; args: unknown[] }

function fixture() {
  const handlers = new Map<string, HandlerFn>()
  const pushes: Push[] = []
  const server = {
    handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) },
    push(channel: string, target: unknown, ...args: unknown[]) { pushes.push({ channel, target, args }) },
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer

  let now = 1_000
  const registry = new NodeRegistry({
    presenceTtlMs: 100,
    maxPendingPerNode: 2,
    invokeTimeoutMs: 50,
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
  })
  registerNodeHandlers(server, { nodes: registry } as unknown as HandlerDeps)

  const ctx: RequestContext = { clientId: 'c', workspaceId: null, webContentsId: null }
  const call = <T = unknown>(channel: string, input?: unknown): T =>
    handlers.get(channel)!(ctx, input) as T
  /** Call as an arbitrary connection, to exercise connection fencing. */
  const callAs = <T = unknown>(clientId: string, channel: string, input?: unknown): T =>
    handlers.get(channel)!({ clientId, workspaceId: null, webContentsId: null }, input) as T
  return { handlers, pushes, registry, call, callAs, advance: (ms: number) => { now += ms } }
}

describe('nodes:* handlers', () => {
  it('registers exactly the six node RPC channels', () => {
    expect([...fixture().handlers.keys()].sort()).toEqual([
      RPC_CHANNELS.nodes.INVOKE,
      RPC_CHANNELS.nodes.INVOKE_CANCEL,
      RPC_CHANNELS.nodes.INVOKE_RESULT,
      RPC_CHANNELS.nodes.LIST,
      RPC_CHANNELS.nodes.PRESENCE,
      RPC_CHANNELS.nodes.REGISTER,
    ])
  })

  it('register stores claims and pushes nodes:changed', () => {
    const f = fixture()
    const view = f.call<{ nodeId: string; online: boolean; authorizedCommands: string[] }>(
      RPC_CHANNELS.nodes.REGISTER,
      { nodeId: 'mac-1', declaredCaps: ['system.run'], declaredCommands: ['system.run'] },
    )
    expect(view).toMatchObject({ nodeId: 'mac-1', online: true, authorizedCommands: [] })
    expect(f.pushes).toEqual([{
      channel: RPC_CHANNELS.nodes.CHANGED,
      target: { to: 'all' },
      args: [{ reason: 'registered', nodeId: 'mac-1' }],
    }])
    expect(f.call<unknown[]>(RPC_CHANNELS.nodes.LIST)).toHaveLength(1)
  })

  it('rejects a malformed declaration', () => {
    const f = fixture()
    expect(() => f.call(RPC_CHANNELS.nodes.REGISTER, { nodeId: 42 })).toThrow(CodedError)
  })

  it('presence heartbeat returns status, unknown node is NOT_FOUND', () => {
    const f = fixture()
    f.call(RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1' })
    expect(f.call(RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'mac-1' })).toMatchObject({ nodeId: 'mac-1', online: true })
    try {
      f.call(RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'ghost' })
      throw new Error('expected throw')
    } catch (error) {
      const coded = error as CodedError
      expect(coded.code).toBe('NOT_FOUND')
    }
  })

  it('invoke refuses a not-allowlisted claim without pushing anything', async () => {
    const f = fixture()
    f.call(RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })
    const result = await f.call<Promise<unknown>>(RPC_CHANNELS.nodes.INVOKE, { nodeId: 'mac-1', command: 'system.run' })
    expect(result).toMatchObject({ status: 'error', error: { code: 'NOT_ALLOWLISTED' } })
    expect(f.pushes.some((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)).toBe(false)
  })

  it('invoke round-trips: pushes node:invoke, node reports result, terminal once', async () => {
    const f = fixture()
    f.registry.setAllowlist('mac-1', { commands: ['system.run'] })
    f.call(RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })

    const pending = f.call<Promise<{ status: string; invokeId: string; payload: unknown }>>(
      RPC_CHANNELS.nodes.INVOKE,
      { nodeId: 'mac-1', command: 'system.run', payload: { argv: ['ls'] } },
    )
    const pushed = f.pushes.find((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)
    // Fenced: the invoke is addressed to the registering connection, never broadcast.
    expect(pushed?.target).toEqual({ to: 'client', clientId: 'c' })
    // Handler-owned push shape: { invokeId, nodeId, command, payload? }.
    const pushedInvoke = pushed!.args[0] as { invokeId: string }
    const invokeId = pushedInvoke.invokeId
    expect(pushed!.args[0]).toMatchObject({ nodeId: 'mac-1', command: 'system.run', payload: { argv: ['ls'] } })

    expect(f.call<{ ok: boolean }>(RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { exitCode: 0 } })).toEqual({ ok: true })
    expect(await pending).toMatchObject({ status: 'ok', payload: { exitCode: 0 } })

    // Second report for the same invoke is a typed NOT_FOUND, never a double-settle.
    try {
      f.call(RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { exitCode: 1 } })
      throw new Error('expected throw')
    } catch (error) {
      const coded = error as CodedError
      expect(coded.code).toBe('NOT_FOUND')
    }
  })

  it('invoke cancel settles once', async () => {
    const f = fixture()
    f.registry.setAllowlist('mac-1', { commands: ['system.run'] })
    f.call(RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })
    const pending = f.call<Promise<{ status: string; error: { code: string } }>>(
      RPC_CHANNELS.nodes.INVOKE,
      { nodeId: 'mac-1', command: 'system.run' },
    )
    // Handler-owned push shape: { invokeId, nodeId, command }.
    const cancelPush = f.pushes.find((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)!.args[0] as { invokeId: string }
    const invokeId = cancelPush.invokeId

    expect(f.call<{ cancelled: boolean }>(RPC_CHANNELS.nodes.INVOKE_CANCEL, { invokeId })).toEqual({ cancelled: true })
    expect(await pending).toMatchObject({ status: 'error', error: { code: 'CANCELLED' } })
    expect(f.call<{ cancelled: boolean }>(RPC_CHANNELS.nodes.INVOKE_CANCEL, { invokeId })).toEqual({ cancelled: false })
  })

  it('a re-registration under a new connection supersedes in-flight invokes', async () => {
    const f = fixture()
    f.registry.setAllowlist('mac-1', { commands: ['system.run'] })
    f.callAs('conn-a', RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })

    const pending = f.callAs<Promise<{ status: string; error: { code: string } }>>(
      'requester', RPC_CHANNELS.nodes.INVOKE, { nodeId: 'mac-1', command: 'system.run' },
    )
    const invokePush = f.pushes.find((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)!.args[0] as { invokeId: string }
    const invokeId = invokePush.invokeId

    f.callAs('conn-b', RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })
    expect(await pending).toMatchObject({ status: 'error', error: { code: 'SUPERSEDED' } })

    // The stale connection's late answer is refused typed; nothing is re-settled.
    try {
      f.callAs('conn-a', RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { late: true } })
      throw new Error('expected throw')
    } catch (error) {
      const coded = error as CodedError
      expect(coded.code).toBe('NOT_FOUND')
    }
  })

  it('refuses an invoke result presented by a connection that does not own it', async () => {
    const f = fixture()
    f.registry.setAllowlist('mac-1', { commands: ['system.run'] })
    f.callAs('conn-a', RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1', declaredCommands: ['system.run'] })

    const pending = f.callAs<Promise<{ status: string; payload: unknown }>>(
      'requester', RPC_CHANNELS.nodes.INVOKE, { nodeId: 'mac-1', command: 'system.run' },
    )
    const invokePush = f.pushes.find((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)!.args[0] as { invokeId: string }
    const invokeId = invokePush.invokeId

    // An impostor connection is refused typed and must NOT settle the invoke.
    try {
      f.callAs('conn-b', RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { stolen: true } })
      throw new Error('expected throw')
    } catch (error) {
      const coded = error as CodedError
      expect(coded.code).toBe('NODE_CONNECTION_MISMATCH')
    }
    expect(f.registry.pendingCountFor('mac-1')).toBe(1)

    // The real owner still settles it.
    expect(f.callAs<{ ok: true }>('conn-a', RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { ok: 1 } })).toEqual({ ok: true })
    expect(await pending).toMatchObject({ status: 'ok', payload: { ok: 1 } })
  })

  it('refuses a heartbeat from a superseded connection', () => {
    const f = fixture()
    f.callAs('conn-a', RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1' })
    f.callAs('conn-b', RPC_CHANNELS.nodes.REGISTER, { nodeId: 'mac-1' })

    expect(f.callAs('conn-b', RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'mac-1' })).toMatchObject({ online: true })
    try {
      f.callAs('conn-a', RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'mac-1' })
      throw new Error('expected throw')
    } catch (error) {
      const coded = error as CodedError
      expect(coded.code).toBe('NODE_CONNECTION_MISMATCH')
    }
  })

  it('settles a node with no connection identity as UNROUTABLE instead of broadcasting', async () => {
    const f = fixture()
    // A host-composed node (registered directly, no transport connection).
    f.registry.registerNode({ nodeId: 'mac-1', declaredCommands: ['system.run'] })
    f.registry.setAllowlist('mac-1', { commands: ['system.run'] })

    const result = await f.callAs<Promise<unknown>>('requester', RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'mac-1', command: 'system.run',
    })
    expect(result).toMatchObject({ status: 'error', error: { code: 'NODE_UNROUTABLE' } })
    // Nothing was pushed to any client — the payload never leaks.
    expect(f.pushes.some((push) => push.channel === RPC_CHANNELS.nodes.INVOKE)).toBe(false)
  })
})