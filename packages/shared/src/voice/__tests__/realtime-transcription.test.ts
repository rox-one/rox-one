import { describe, expect, it } from 'bun:test'
import {
  createRealtimeTranscriptionSession,
  type RealtimeSocket,
  type RealtimeSocketHandlers,
  type RealtimeTranscriptionEvent,
} from '../realtime-transcription.ts'
import type { RealtimeTimerScheduler } from '../realtime-bridge.ts'

interface FakeSocket extends RealtimeSocket {
  handlers: RealtimeSocketHandlers
  sent: Array<string | Uint8Array>
  open(): void
  receive(data: string): void
  serverClose(code?: number, reason?: string): void
}

function fakeOpener() {
  const sockets: FakeSocket[] = []
  let readyState: RealtimeSocket['readyState'] = 'connecting'
  const open = (_url: string, _headers: Record<string, string> | undefined, handlers: RealtimeSocketHandlers): RealtimeSocket => {
    const socket: FakeSocket = {
      handlers,
      sent: [],
      get readyState() { return readyState },
      send(data) { socket.sent.push(data) },
      close() { readyState = 'closed' },
      open() { readyState = 'open'; handlers.onOpen() },
      receive(data) { handlers.onMessage(data) },
      serverClose(code = 1006, reason = 'dropped') { readyState = 'closed'; handlers.onClose(code, reason) },
    }
    sockets.push(socket)
    return socket
  }
  return { open, sockets, last: () => sockets[sockets.length - 1]! }
}

function manualScheduler() {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  const schedule: RealtimeTimerScheduler = (fn, ms) => {
    const timer = { fn, ms, cancelled: false }
    timers.push(timer)
    return () => { timer.cancelled = true }
  }
  const fire = () => {
    const timer = timers.find((entry) => !entry.cancelled)
    if (!timer) throw new Error('no scheduled timer')
    timer.cancelled = true
    timer.fn()
  }
  return { schedule, fire }
}

const transcript = (text: string) => JSON.stringify({ type: 'transcript', text })

function build(scheduler: RealtimeTimerScheduler, overrides: { maxAttempts?: number } = {}) {
  const wire = fakeOpener()
  const events: RealtimeTranscriptionEvent[] = []
  const session = createRealtimeTranscriptionSession({
    url: 'ws://fixture/transcribe',
    open: wire.open,
    handshake: () => JSON.stringify({ type: 'session.update' }),
    encodeAudio: (chunk) => Buffer.from(chunk).toString('base64'),
    decodeMessage: (data) => {
      const frame = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as { type: string; text?: string }
      if (frame.type === 'transcript') return { kind: 'transcript', text: frame.text ?? '', final: true, sequence: 0 }
      if (frame.type === 'partial') return { kind: 'partial', text: frame.text ?? '', sequence: 0 }
      return null
    },
    schedule: scheduler,
    maxAttempts: overrides.maxAttempts ?? 3,
  })
  session.onEvent((event) => events.push(event))
  return { wire, session, events }
}

describe('realtime transcription relay', () => {
  it('handshakes on open, encodes audio and emits a monotonic event stream', async () => {
    const { schedule } = manualScheduler()
    const { wire, session, events } = build(schedule)
    await session.connect()
    wire.last().open()
    expect(wire.last().sent[0]).toBe(JSON.stringify({ type: 'session.update' }))
    expect(events[0]).toEqual({ kind: 'ready', sequence: 1 })
    expect(session.isConnected()).toBe(true)
    session.sendAudio(Uint8Array.from([1, 2, 3]))
    expect(wire.last().sent[1]).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    wire.last().receive(transcript('привет'))
    wire.last().receive(transcript('мир'))
    expect(events.slice(1)).toEqual([
      { kind: 'transcript', text: 'привет', final: true, sequence: 2 },
      { kind: 'transcript', text: 'мир', final: true, sequence: 3 },
    ])
  })

  it('queues audio while not ready and flushes it in order on connect', async () => {
    const { schedule } = manualScheduler()
    const { wire, session } = build(schedule)
    await session.connect()
    session.sendAudio(Uint8Array.from([9]))
    session.sendAudio(Uint8Array.from([8]))
    expect(session.queued()).toEqual({ chunks: 2, bytes: 2, droppedChunks: 0 })
    wire.last().open()
    expect(wire.last().sent.slice(1)).toEqual([Buffer.from([9]).toString('base64'), Buffer.from([8]).toString('base64')])
    expect(session.queued().chunks).toBe(0)
  })

  it('reconnects after an unexpected close and re-handshakes', async () => {
    const { schedule, fire } = manualScheduler()
    const { wire, session, events } = build(schedule)
    await session.connect()
    wire.last().open()
    wire.last().serverClose(1006, 'network')
    expect(events.at(-1)).toEqual({ kind: 'close', error: 'network', sequence: 2 })
    expect(session.isConnected()).toBe(false)
    fire()
    expect(wire.sockets).toHaveLength(2)
    wire.last().open()
    expect(wire.last().sent[0]).toBe(JSON.stringify({ type: 'session.update' }))
    expect(events.at(-1)).toEqual({ kind: 'ready', sequence: 3 })
  })

  it('settles in a terminal error after exhausting reconnect attempts', async () => {
    const { schedule, fire } = manualScheduler()
    const { wire, session, events } = build(schedule, { maxAttempts: 2 })
    await session.connect()
    wire.last().open()
    wire.last().serverClose()
    fire()
    wire.last().serverClose()
    expect(events.at(-1)?.kind).toBe('error')
    expect(session.isConnected()).toBe(false)
  })

  it('close is terminal and stops sending', async () => {
    const { schedule } = manualScheduler()
    const { wire, session } = build(schedule)
    await session.connect()
    wire.last().open()
    session.close('done')
    session.sendAudio(Uint8Array.from([1]))
    expect(wire.sockets).toHaveLength(1)
    expect(session.isConnected()).toBe(false)
  })
})