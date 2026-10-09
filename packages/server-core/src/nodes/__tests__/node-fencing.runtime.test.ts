/**
 * e2.2 — node-plane fencing over the real transport.
 *
 * Two REAL `WsRpcClient` connections register the same nodeId; the host binds
 * each to its server-minted `clientId` (its connection identity). The second
 * registration supersedes the first: the stale connection's in-flight invoke
 * settles `SUPERSEDED` and its late `nodes:invokeResult` is refused typed, so
 * it cannot win a race against the live connection. The invoke push is
 * addressed to the owning connection (`{ to: 'client' }`), so no unrelated
 * client sees the payload.
 *
 * Presence TTL is driven by an injected clock (deterministic); invoke timeouts
 * use inert timers so `registry.sweep()` is the only clock mover.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { NodeClient, NodeRegistry, type NodeInvokeRequest } from '../index.ts'
import { WsRpcClient } from '../../transport/client.ts'
import { WsRpcServer } from '../../transport/server.ts'
import { registerNodeHandlers } from '../../handlers/rpc/nodes.ts'
import type { HandlerDeps } from '../../handlers/handler-deps'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * Frames cross a real loopback socket, so falsifying timers cannot drive it and
 * completion is observed by polling the awaited condition — not a guessed
 * delay. This is the one place a real clock is required.
 */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

function spinUp() {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
  let now = 1_000_000
  const registry = new NodeRegistry({
    presenceTtlMs: 500,
    maxPendingPerNode: 8,
    invokeTimeoutMs: 60_000,
    now: () => now,
    setTimer: () => 0,
    clearTimer: () => {},
  })
  registerNodeHandlers(server, { nodes: registry } as unknown as HandlerDeps)
  cleanups.push(() => { server.close() })
  return { server, registry, advance: (ms: number) => { now += ms } }
}

function connect(url: string): WsRpcClient {
  const rpc = new WsRpcClient(url, { autoReconnect: false, connectTimeout: 1_000, requestTimeout: 5_000 })
  cleanups.push(() => rpc.destroy())
  return rpc
}

/** Collect the invokes pushed to a connection, validating each frame shape. */
function attachNode(rpc: WsRpcClient): NodeInvokeRequest[] {
  const invokes: NodeInvokeRequest[] = []
  rpc.on(RPC_CHANNELS.nodes.INVOKE, (raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return
    const candidate = raw as Partial<NodeInvokeRequest>
    if (typeof candidate.invokeId !== 'string' || typeof candidate.command !== 'string') return
    invokes.push({
      invokeId: candidate.invokeId,
      nodeId: typeof candidate.nodeId === 'string' ? candidate.nodeId : '?',
      command: candidate.command,
      ...(candidate.payload !== undefined ? { payload: candidate.payload } : {}),
    })
  })
  return invokes
}

/** Resolve to the rejection (or null) so a typed refusal can be asserted directly. */
function rejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(() => null, (error: unknown) => error)
}

const NODE_DECLARATION = { nodeId: 'n1', declaredCommands: ['sys.echo', 'sys.slow'] }

describe('node-plane fencing (real WS transport)', () => {
  it('two connections for one nodeId: the superseded one is refused and its invoke settles SUPERSEDED', async () => {
    const { server, registry, advance } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`
    registry.setAllowlist('n1', { commands: ['sys.echo', 'sys.slow'] })

    const stale = connect(url)
    const staleInvokes = attachNode(stale)
    const live = connect(url)
    const liveInvokes = attachNode(live)
    const unrelated = connect(url)
    const unrelatedInvokes = attachNode(unrelated)
    const requester = connect(url)

    // Two connections, same nodeId, distinct server-minted connection identities.
    await stale.invoke(RPC_CHANNELS.nodes.REGISTER, NODE_DECLARATION)
    await unrelated.invoke(RPC_CHANNELS.nodes.LIST) // connected, but owns nothing

    // 1 — the invoke is addressed to the owning connection only.
    const supersededPending = requester.invoke(RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'n1', command: 'sys.slow', timeoutMs: 5_000,
    })
    await until(() => staleInvokes.length === 1)
    expect(liveInvokes).toHaveLength(0)
    expect(unrelatedInvokes).toHaveLength(0)
    const supersededInvokeId = staleInvokes[0]!.invokeId

    // 2 — the live connection takes the node over; the stale invoke is cancelled.
    await live.invoke(RPC_CHANNELS.nodes.REGISTER, NODE_DECLARATION)
    expect(await supersededPending).toMatchObject({ status: 'error', error: { code: 'SUPERSEDED' } })

    // 3 — the stale connection's late answer is refused typed.
    const lateAnswer = await rejection(stale.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, {
      invokeId: supersededInvokeId, payload: { late: true },
    }))
    expect(lateAnswer).toMatchObject({ code: 'NOT_FOUND' })

    // 4 — heartbeat keeps presence for the live connection; the stale one is refused.
    expect(await live.invoke(RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'n1' })).toMatchObject({ nodeId: 'n1', online: true })
    const staleHeartbeat = await rejection(stale.invoke(RPC_CHANNELS.nodes.PRESENCE, { nodeId: 'n1' }))
    expect(staleHeartbeat).toMatchObject({ code: 'NODE_CONNECTION_MISMATCH' })

    // 5 — a new invoke reaches only the live connection; the stale one cannot settle it.
    const livePending = requester.invoke(RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'n1', command: 'sys.echo', payload: { n: 1 },
    })
    await until(() => liveInvokes.length === 1)
    expect(staleInvokes).toHaveLength(1)
    expect(unrelatedInvokes).toHaveLength(0)
    const liveInvokeId = liveInvokes[0]!.invokeId

    const impostor = await rejection(stale.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, {
      invokeId: liveInvokeId, payload: { stolen: true },
    }))
    expect(impostor).toMatchObject({ code: 'NODE_CONNECTION_MISMATCH' })
    expect(registry.pendingCountFor('n1')).toBe(1) // the impostor did NOT settle it

    expect(await live.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId: liveInvokeId, payload: { echoed: true } }))
      .toEqual({ ok: true })
    expect(await livePending).toMatchObject({ status: 'ok', invokeId: liveInvokeId, payload: { echoed: true } })

    // 6 — TTL expiry still fails an in-flight invoke (the V12 property).
    const ttlPending = requester.invoke(RPC_CHANNELS.nodes.INVOKE, { nodeId: 'n1', command: 'sys.echo' })
    await until(() => liveInvokes.length === 2)
    advance(501)
    const swept = registry.sweep()
    expect(swept.expired).toEqual(['n1'])
    expect(swept.failedInvokes).toBe(1)
    expect(await ttlPending).toMatchObject({ status: 'error', error: { code: 'DISCONNECTED' } })
  })

  it('an invoke push is not delivered to an unrelated client', async () => {
    const { server, registry } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`
    registry.setAllowlist('n1', { commands: ['sys.echo'] })

    const node = connect(url)
    const nodeInvokes = attachNode(node)
    const unrelated = connect(url)
    const unrelatedInvokes = attachNode(unrelated)
    const requester = connect(url)

    await node.invoke(RPC_CHANNELS.nodes.REGISTER, { nodeId: 'n1', declaredCommands: ['sys.echo'] })
    await unrelated.invoke(RPC_CHANNELS.nodes.LIST)

    const pending = requester.invoke(RPC_CHANNELS.nodes.INVOKE, { nodeId: 'n1', command: 'sys.echo' })
    await until(() => nodeInvokes.length === 1)
    const invokeId = nodeInvokes[0]!.invokeId
    await node.invoke(RPC_CHANNELS.nodes.INVOKE_RESULT, { invokeId, payload: { ok: true } })
    expect(await pending).toMatchObject({ status: 'ok', invokeId })

    // The push was emitted at dispatch, strictly before this terminal result, so
    // the completed round-trip proves non-delivery without a guessed delay.
    expect(unrelatedInvokes).toHaveLength(0)
  })

  it('NodeClient registers, heartbeats and answers invokes', async () => {
    const { server, registry } = spinUp()
    await server.listen()
    const url = `ws://127.0.0.1:${server.port}`
    registry.setAllowlist('n2', { commands: ['sys.echo'] })

    const node = new NodeClient({
      url,
      nodeId: 'n2',
      declaredCommands: ['sys.echo'],
      autoReconnect: false,
      onInvoke: (request) => ({ echoed: request.payload }),
    })
    cleanups.push(() => node.destroy())

    expect(await node.register()).toMatchObject({ nodeId: 'n2', online: true, authorizedCommands: ['sys.echo'] })
    expect(await node.heartbeat()).toMatchObject({ nodeId: 'n2', online: true })

    const requester = connect(url)
    const result = await requester.invoke(RPC_CHANNELS.nodes.INVOKE, {
      nodeId: 'n2', command: 'sys.echo', payload: { n: 7 },
    })
    expect(result).toMatchObject({ status: 'ok', nodeId: 'n2', payload: { echoed: { n: 7 } } })
  })
})