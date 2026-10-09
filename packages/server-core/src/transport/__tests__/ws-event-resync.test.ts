import { afterEach, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { PROTOCOL_VERSION } from '@rox/shared/protocol'
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

test('sequence gap holds the watermark below the hole and resyncs exactly once', async () => {
  const { wire, client, resyncs } = await connectedPeer()
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)
  expect(resyncs).toEqual([])

  // Event seq 2 is lost: seq 3 opens a gap.
  wire.send(0, { type: 'event', channel: 'tick', args: [3], seq: 3 })
  await until(() => resyncs.length === 1)

  // Further gappy frames on the same hole must not storm recovery.
  wire.send(0, { type: 'event', channel: 'tick', args: [4], seq: 4 })
  wire.send(0, { type: 'event', channel: 'tick', args: [9], seq: 9 })
  await until(() => ticks.length === 4)

  expect(resyncs).toEqual([true])
  // The watermark never crossed the hole, so sequence_ack cannot let the server
  // evict the buffered event 2.
  expect(watermark(client)).toBe(1)
})

test('undecodable frame forces a resync and leaves the watermark untouched', async () => {
  const { wire, client, resyncs } = await connectedPeer()

  wire.sendRaw(0, 'definitely-not-an-envelope')
  await until(() => resyncs.length === 1)

  // Frame ordering guarantees the peer consumed both bad frames before the
  // probe arrives; the probe (seq 0, already covered) adds no gap of its own.
  let probed = false
  client.on('probe', () => { probed = true })
  wire.sendRaw(0, '{"not":"an envelope"}')
  wire.send(0, { type: 'event', channel: 'probe', args: [], seq: 0 })
  await until(() => probed)

  expect(resyncs).toEqual([true])
  expect(watermark(client)).toBe(0)
})

test('duplicate frames do not move the watermark backwards and are not a gap', async () => {
  const { wire, client, resyncs } = await connectedPeer()
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  wire.send(0, { type: 'event', channel: 'tick', args: [2], seq: 2 })
  await until(() => watermark(client) === 2)

  // Replayed/duplicate frame already covered by the watermark.
  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => ticks.length === 3)

  expect(resyncs).toEqual([])
  expect(watermark(client)).toBe(2)
})

test('a replayed contiguous run after a gap re-arms resync for a later loss', async () => {
  const { wire, client, resyncs } = await connectedPeer()

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)
  wire.send(0, { type: 'event', channel: 'tick', args: [3], seq: 3 })
  await until(() => resyncs.length === 1)

  // Server replays the missed event 2 after a reconnect handshake it recognizes
  // (reconnected:true keeps the watermark), which also clears the resync latch.
  wire.ack(0, { reconnected: true })
  await until(() => client.getConnectionState().status === 'connected')
  wire.send(0, { type: 'event', channel: 'tick', args: [2], seq: 2 })
  await until(() => watermark(client) === 2)
  wire.send(0, { type: 'event', channel: 'tick', args: [7], seq: 7 })
  await until(() => resyncs.length === 2)

  expect(resyncs).toEqual([true, true])
  expect(watermark(client)).toBe(2)
})

test('gap replay after reconnect does not double delivered post-hole events nor lose the hole', async () => {
  const { wire, client, resyncs } = await connectedPeer()
  const ticks: number[] = []
  client.on('tick', (n: number) => ticks.push(n))

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)

  // seq 2 is lost: seq 3 opens the gap. Both 3 and 4 are still applied live,
  // out of order, while the watermark stays frozen below the hole.
  wire.send(0, { type: 'event', channel: 'tick', args: [3], seq: 3 })
  wire.send(0, { type: 'event', channel: 'tick', args: [4], seq: 4 })
  await until(() => ticks.length === 3)
  expect(resyncs).toEqual([true])
  expect(watermark(client)).toBe(1)

  // Reconnect: the client reports lastSeq 1, so the server replays 2, 3 and 4.
  client.reconnectNow()
  await until(() => wire.handshakes.length === 2)
  wire.ack(1, { reconnected: true })
  await until(() => client.getConnectionState().status === 'connected')
  wire.send(1, { type: 'event', channel: 'tick', args: [2], seq: 2 })
  wire.send(1, { type: 'event', channel: 'tick', args: [3], seq: 3 })
  wire.send(1, { type: 'event', channel: 'tick', args: [4], seq: 4 })
  await until(() => watermark(client) === 4)

  // The missing event 2 is applied exactly once; the already-applied 3 and 4
  // are not re-dispatched. No loss, no duplicate.
  expect(ticks).toEqual([1, 3, 4, 2])
  // One resync from the gap; the recognized reconnect emits a non-stale reconnect.
  expect(resyncs).toEqual([true, false])
  expect(watermark(client)).toBe(4)
})

test('stale reconnect adopts the next seq as baseline without a resync', async () => {
  const { wire, client, resyncs } = await connectedPeer()

  wire.send(0, { type: 'event', channel: 'tick', args: [1], seq: 1 })
  await until(() => watermark(client) === 1)

  // Server could not replay (buffer evicted) and continued its sequence.
  wire.ack(0, { reconnected: true, stale: true })
  wire.send(0, { type: 'event', channel: 'tick', args: [42], seq: 42 })
  await until(() => watermark(client) === 42)

  // The adopted floor is a real baseline: a later loss still resyncs once.
  wire.send(0, { type: 'event', channel: 'tick', args: [44], seq: 44 })
  await until(() => resyncs.length === 1)

  expect(resyncs).toEqual([true])
  expect(watermark(client)).toBe(42)
})