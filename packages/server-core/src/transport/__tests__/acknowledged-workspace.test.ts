import { afterEach, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { PROTOCOL_VERSION } from '@craft-agent/shared/protocol'
import { WsRpcClient, type TransportConnectionStatus } from '../client'
import { WsRpcServer } from '../server'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

function acknowledged(client: WsRpcClient): string | null {
  expect(typeof client.getAcknowledgedWorkspaceId).toBe('function')
  return client.getAcknowledgedWorkspaceId()
}

function connect(url: string, workspaceId = 'requested-workspace', autoReconnect = false) {
  const client = new WsRpcClient(url, { workspaceId, autoReconnect, connectTimeout: 1_000, maxReconnectDelay: 20 })
  cleanups.push(() => client.destroy())
  return client
}

// This peer sends real frames over loopback WS. It tests received ACK metadata,
// not PostgreSQL identity authority or permission enforcement.
function peer() {
  const handshakes: Array<{ socket: ServerWebSocket<undefined>; workspaceId: unknown; id: string }> = []
  const sockets = new Set<ServerWebSocket<undefined>>()
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response('WS only', { status: 400 }) },
    websocket: {
      open(socket: ServerWebSocket<undefined>) { sockets.add(socket) },
      message(socket: ServerWebSocket<undefined>, raw: string | Buffer) {
        const frame = JSON.parse(raw.toString())
        if (frame.type === 'handshake') handshakes.push({ socket, workspaceId: frame.workspaceId, id: frame.id })
      },
      close(socket: ServerWebSocket<undefined>) { sockets.delete(socket) },
    },
  })
  cleanups.push(() => { for (const socket of sockets) socket.close(); server.stop(true) })
  function send(index: number, frame: Record<string, unknown>) {
    handshakes[index]!.socket.send(JSON.stringify({ id: crypto.randomUUID(), ...frame }))
  }
  return {
    url: `ws://127.0.0.1:${server.port}`, handshakes, send,
    ack(index: number, workspaceId?: unknown) {
      send(index, { id: handshakes[index]!.id, type: 'handshake_ack', clientId: 'actual-peer-client-' + index,
        protocolVersion: PROTOCOL_VERSION, ...(workspaceId === undefined ? {} : { workspaceId }) })
    },
  }
}

test('real server ACK workspace is visible before connected state callbacks', async () => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: false })
  await server.listen()
  cleanups.push(() => server.close())
  const client = connect(`ws://127.0.0.1:${server.port}`, 'server-bound-workspace')
  expect(acknowledged(client)).toBeNull()
  const published: Array<{ status: TransportConnectionStatus; ack: string | null }> = []
  client.onConnectionStateChanged(state => published.push({ status: state.status, ack: acknowledged(client) }))
  client.connect()
  await until(() => client.getConnectionState().status === 'connected')
  expect(acknowledged(client)).toBe('server-bound-workspace')
  expect(published.find(state => state.status === 'connected')?.ack).toBe('server-bound-workspace')
})

for (const [name, value] of [['missing', undefined], ['null', null], ['number', 7], ['object', { id: 'requested-workspace' }], ['empty', ''], ['whitespace', '  ']] as const) {
  test(`real ${name} ACK workspace cannot become the requested workspace`, async () => {
    const wire = peer(), client = connect(wire.url)
    client.connect()
    await until(() => wire.handshakes.length === 1)
    wire.ack(0, value)
    await until(() => client.getConnectionState().status === 'connected')
    expect(wire.handshakes[0]!.workspaceId).toBe('requested-workspace')
    expect(acknowledged(client)).toBeNull()
  })
}

test('mismatched actual ACK retains the server value and never substitutes requested scope', async () => {
  const wire = peer(), client = connect(wire.url)
  client.connect()
  await until(() => wire.handshakes.length === 1)
  wire.ack(0, 'foreign-actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  expect(acknowledged(client)).toBe('foreign-actual-workspace')
  expect(acknowledged(client)).not.toBe(wire.handshakes[0]!.workspaceId)
})

test('reconnect clears old ACK before state publication and waits for the new actual ACK', async () => {
  const wire = peer(), client = connect(wire.url)
  const published: Array<{ status: TransportConnectionStatus; ack: string | null }> = []
  client.onConnectionStateChanged(state => published.push({ status: state.status, ack: acknowledged(client) }))
  client.connect()
  await until(() => wire.handshakes.length === 1)
  wire.ack(0, 'first-actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  expect(acknowledged(client)).toBe('first-actual-workspace')
  client.reconnectNow()
  await until(() => wire.handshakes.length === 2)
  expect(acknowledged(client)).toBeNull()
  expect(published.filter(state => state.status !== 'connected').every(state => state.ack === null)).toBe(true)
  wire.ack(1, 'second-actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  expect(acknowledged(client)).toBe('second-actual-workspace')
  expect(published.filter(state => state.status === 'connected').map(state => state.ack)).toEqual(['first-actual-workspace', 'second-actual-workspace'])
})

test('automatic retry clears ACK while the next wire handshake remains unacknowledged', async () => {
  const wire = peer(), client = connect(wire.url, 'requested-workspace', true)
  client.connect()
  await until(() => wire.handshakes.length === 1)
  wire.ack(0, 'old-actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  wire.handshakes[0]!.socket.close()
  await until(() => wire.handshakes.length === 2)
  expect(acknowledged(client)).toBeNull()
  expect(client.getConnectionState().status).toBe('reconnecting')
  wire.ack(1, 'new-actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  expect(acknowledged(client)).toBe('new-actual-workspace')
})

for (const boundary of ['error', 'shutdown', 'destroy'] as const) {
  test(`${boundary} clears actual ACK before non-connected state and event callbacks`, async () => {
    const wire = peer(), client = connect(wire.url)
    const published: Array<{ status: TransportConnectionStatus; ack: string | null }> = []
    client.onConnectionStateChanged(state => published.push({ status: state.status, ack: acknowledged(client) }))
    client.connect()
    await until(() => wire.handshakes.length === 1)
    wire.ack(0, 'actual-workspace')
    await until(() => client.getConnectionState().status === 'connected')
    let shutdownAck: string | null | undefined
    client.on('server:shuttingDown', () => { shutdownAck = acknowledged(client) })
    if (boundary === 'error') wire.send(0, { type: 'error', error: { code: 'AUTH_FAILED', message: 'owned fixture denial' } })
    else if (boundary === 'shutdown') wire.send(0, { type: 'event', channel: 'server:shuttingDown', args: [] })
    else client.destroy()
    await until(() => client.getConnectionState().status !== 'connected')
    expect(acknowledged(client)).toBeNull()
    expect(published.filter(state => state.status !== 'connected').every(state => state.ack === null)).toBe(true)
    if (boundary === 'shutdown') expect(shutdownAck).toBeNull()
  })
}

for (const boundary of ['error', 'shutdown'] as const) {
  test(`late wire ACK after ${boundary} cannot restore cleared workspace scope`, async () => {
    const wire = peer(), client = connect(wire.url)
    client.connect()
    await until(() => wire.handshakes.length === 1)
    wire.ack(0, 'actual-workspace')
    await until(() => client.getConnectionState().status === 'connected')
    if (boundary === 'error') wire.send(0, { type: 'error', error: { code: 'AUTH_FAILED', message: 'owned fixture denial' } })
    else wire.send(0, { type: 'event', channel: 'server:shuttingDown', args: [] })
    await until(() => client.getConnectionState().status !== 'connected')
    let lateFrameProcessed = false
    client.on('owned-late-frame', () => { lateFrameProcessed = true })
    wire.ack(0, 'late-foreign-workspace')
    wire.send(0, { type: 'event', channel: 'owned-late-frame', args: [] })
    await until(() => lateFrameProcessed)
    expect(acknowledged(client)).toBeNull()
  })
}

test('response and event workspace fields cannot overwrite received ACK scope', async () => {
  const wire = peer(), client = connect(wire.url)
  client.connect()
  await until(() => wire.handshakes.length === 1)
  wire.ack(0, 'actual-workspace')
  await until(() => client.getConnectionState().status === 'connected')
  let eventSeen = false
  client.on('owned-fixture-event', () => { eventSeen = true })
  wire.send(0, { type: 'response', workspaceId: 'forged-response-workspace', result: {} })
  wire.send(0, { type: 'event', channel: 'owned-fixture-event', workspaceId: 'forged-event-workspace', args: [] })
  await until(() => eventSeen)
  expect(acknowledged(client)).toBe('actual-workspace')
})
