import { afterEach, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { serializeEnvelope } from '../codec'
import { WsRpcClient } from '../client'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// Frames cross a real loopback WebSocket, so completion is observed by polling
// the awaited condition (not a guessed delay). Fake timers cannot drive the
// platform socket, so this integration harness uses the real clock.
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

/**
 * Private delivery watermark. Reached through a named cast because the client
 * intentionally exposes no public accessor — the test asserts the internal
 * invariant that a sequence gap must not advance it.
 */
type WatermarkView = { readonly lastSeenSeq: number }
const watermarkView = (client: WsRpcClient): WatermarkView => client as unknown as WatermarkView
const watermark = (client: WsRpcClient): number => watermarkView(client).lastSeenSeq

function connect(url: string) {
  const client = new WsRpcClient(url, { workspaceId: 'resync-workspace', autoReconnect: false, connectTimeout: 1_000 })
  cleanups.push(() => client.destroy())
  return client
}

/**
 * Loopback peer that performs the real handshake exchange so the client reaches
 * `connected`, then lets the test drive raw event frames — including gaps and
 * undecodable frames that a real server would never emit.
 */
function peer() {
  const handshakes: Array<{ socket: ServerWebSocket<undefined>; id: string }> = []
  const sockets: Array<ServerWebSocket<undefined>> = []
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response('WS only', { status: 400 }) },
    websocket: {
      open(socket: ServerWebSocket<undefined>) { sockets.push(socket) },
      message(socket: ServerWebSocket<undefined>, raw: string | Buffer) {
        const frame = JSON.parse(raw.toString())
        if (frame.type === 'handshake') handshakes.push({ socket, id: frame.id })
      },
    },
  })
  cleanups.push(() => { for (const socket of sockets) socket.close(); server.stop(true) })
  function send(index: number, frame: Record<string, unknown>) {
    handshakes[index]!.socket.send(JSON.stringify({ id: crypto.randomUUID(), ...frame }))
  }
  return {
    url: `ws://127.0.0.1:${server.port}`,
    handshakes,
    send,
    sendRaw(index: number, raw: string) { handshakes[index]!.socket.send(raw) },
    ack(index: number, opts: { reconnected?: boolean; stale?: boolean } = {}) {
      send(index, { id: handshakes[index]!.id, type: 'handshake_ack', clientId: `peer-${index}`,
        protocolVersion: PROTOCOL_VERSION, reconnected: opts.reconnected === true || undefined,
        stale: opts.stale === true || undefined })
    },
  }
}

async function connectedPeer() {
  const wire = peer()
  const client = connect(wire.url)
  const resyncs: boolean[] = []
  client.on('__transport:reconnected', (isStale: boolean) => resyncs.push(isStale))
  client.connect()
  await until(() => wire.handshakes.length === 1)
  wire.ack(0)
  await until(() => client.getConnectionState().status === 'connected')
  return { wire, client, resyncs }
}

/**
 * Direct message-level client. Drives the private handler on a client marked
 * connected with a stubbed `reconnectNow`, so the guard/watermark invariants can
 * be asserted deterministically without racing a real socket close.
 */
type PrivateClient = {
  connected: boolean
  clientId: string | null
  lastSeenSeq: number
  deliveredSeqs: Set<number>
  awaitingBaseline: boolean
  gapRecoveryInFlight: boolean
  reconnectNow(): void
  onMessage(raw: string): void
}
function privateClient(seedSeq: number) {
  const client = new WsRpcClient('ws://127.0.0.1:1', { autoReconnect: false })
  cleanups.push(() => client.destroy())
  const priv = client as unknown as PrivateClient
  priv.connected = true
  priv.clientId = 'client-resync'
  priv.lastSeenSeq = seedSeq

  let reconnects = 0
  priv.reconnectNow = () => { reconnects += 1 }

  return {
    client,
    priv,
    reconnects: () => reconnects,
    event: (seq: number, n: number) => priv.onMessage(serializeEnvelope({
      id: crypto.randomUUID(), type: 'event', channel: 'tick', args: [n], seq,
    } satisfies MessageEnvelope)),
    raw: (raw: string) => priv.onMessage(raw),
    ack: (opts: { reconnected?: boolean; stale?: boolean } = {}) => priv.onMessage(serializeEnvelope({
      id: crypto.randomUUID(), type: 'handshake_ack', clientId: 'client-resync',
      protocolVersion: PROTOCOL_VERSION,
      reconnected: opts.reconnected === true || undefined,
      stale: opts.stale === true || undefined,
    } satisfies MessageEnvelope)),
  }
}

test('a gap holds the watermark below the hole and recovers with a single reconnect', async () => {
  const { wire, client, resyncs } = await connectedPeer()
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)
  expect(resyncs).toEqual([])

  // Event seq 2 is lost: seq 4 opens the gap. The client issues exactly one
  // recovery reconnect (a second handshake at the peer) instead of acking past
  // the hole; the live frame is still dispatched.
  wire.send(0, { type: 'event', channel: 'tick', args: [4], seq: 4 })
  await until(() => wire.handshakes.length === 2 && watermark(client) === 1)
  expect(ticks).toEqual([1, 4])

  // The server recognizes the reconnect and replays from lastSeq=1: 2, 3, 4.
  wire.ack(1, { reconnected: true })
  await until(() => client.getConnectionState().status === 'connected')
  wire.send(1, { type: 'event', channel: 'tick', args: [2], seq: 2 })
  wire.send(1, { type: 'event', channel: 'tick', args: [3], seq: 3 })
  wire.send(1, { type: 'event', channel: 'tick', args: [4], seq: 4 })
  await until(() => watermark(client) === 4)

  // The hole is filled exactly once; the already-applied event 4 replay is
  // suppressed rather than re-dispatched. No loss, no duplicate.
  expect(ticks).toEqual([1, 4, 2, 3])
  // A recognized (non-stale) reconnect triggers no app-level full refresh.
  expect(resyncs).toEqual([false])
  expect(watermark(client)).toBe(4)
})

test('a burst of gapped frames dispatches every frame but requests one reconnect', () => {
  const { client, priv, reconnects, event } = privateClient(1)
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  // Expected 2, received 4, 5 and 9 — one hole, three gapped frames.
  event(4, 4)
  event(5, 5)
  event(9, 9)

  // (a) frames are still dispatched, never dropped
  expect(ticks).toEqual([4, 5, 9])
  // (b) cursor held at the last contiguous seq — never acked/reconnected past the hole
  expect(priv.lastSeenSeq).toBe(1)
  // (c) exactly one recovery reconnect for the whole burst
  expect(reconnects()).toBe(1)
})

test('an undecodable frame runs the same guarded recovery as a gap', () => {
  const { priv, reconnects, raw } = privateClient(5)

  raw('definitely-not-an-envelope')
  expect(reconnects()).toBe(1)
  // The watermark is untouched: we cannot know whether the dropped frame was an
  // event, so the hole (if any) stays replayable.
  expect(priv.lastSeenSeq).toBe(5)

  // A second bad frame on the same in-flight recovery must not storm it.
  raw('{"not":"an envelope"}')
  expect(reconnects()).toBe(1)
  expect(priv.lastSeenSeq).toBe(5)
})

test('a recognized reconnect suppresses the replayed post-hole events without losing the hole', () => {
  const { client, priv, event, ack } = privateClient(1)
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  // Expected 2: 4 and 5 arrive out of order and are applied live.
  event(4, 4)
  event(5, 5)
  expect(ticks).toEqual([4, 5])
  expect(priv.lastSeenSeq).toBe(1)

  // Recognized reconnect keeps the watermark and the delivered-seq set, so the
  // replay of 4 and 5 is deduplicated while 2 and 3 fill the hole.
  ack({ reconnected: true })
  event(2, 2)
  event(3, 3)
  event(4, 4)
  event(5, 5)

  expect(ticks).toEqual([4, 5, 2, 3])
  expect(priv.lastSeenSeq).toBe(5)
  // Every tracked seq was consumed by its replay — the set cannot leak.
  expect(priv.deliveredSeqs.size).toBe(0)
})

test('a stale reconnect adopts the next seq as the new baseline without a reconnect', async () => {
  const { wire, client, resyncs } = await connectedPeer()

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)

  client.reconnectNow()
  await until(() => wire.handshakes.length === 2)
  // Server could not replay (buffer evicted) and continued its sequence.
  wire.ack(1, { reconnected: true, stale: true })
  await until(() => client.getConnectionState().status === 'connected')

  // No replay is coming, so the first post-reconnect seq becomes the floor
  // instead of being read as a gap.
  wire.send(1, { type: 'event', channel: 'tick', args: [42], seq: 42 })
  await until(() => watermark(client) === 42)
  expect(wire.handshakes.length).toBe(2)

  // The adopted floor is a real baseline: a later loss still recovers once.
  wire.send(1, { type: 'event', channel: 'tick', args: [44], seq: 44 })
  await until(() => wire.handshakes.length === 3)

  // The stale reconnect asked the app for a full refresh.
  expect(resyncs).toEqual([true])
})

test('a fresh handshake re-arms recovery and drops the delivered-seq set', () => {
  const { priv, reconnects, event, ack } = privateClient(1)

  event(4, 4)
  expect(reconnects()).toBe(1)
  expect(priv.gapRecoveryInFlight).toBe(true)

  // A fresh handshake (server did not recognize the previous client) resets the
  // baseline and re-arms recovery.
  ack()
  expect(priv.lastSeenSeq).toBe(0)
  expect(priv.gapRecoveryInFlight).toBe(false)
  expect(priv.deliveredSeqs.size).toBe(0)

  // A later loss on the new connection recovers again.
  event(1, 1)
  expect(priv.lastSeenSeq).toBe(1)
  event(5, 5)
  expect(reconnects()).toBe(2)
  expect(priv.lastSeenSeq).toBe(1)
})