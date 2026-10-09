import { afterEach, describe, expect, it } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  createOpenAiRealtimeTranscriptionSession,
  createOpenAiRealtimeVoiceProvider,
  openGlobalWebSocket,
} from '../realtime-providers/openai.ts'

/** Local WebSocket fixture speaking the documented OpenAI realtime framing. */
function fixture() {
  const connections: Array<{ socket: ServerWebSocket<{ authorization: string | null }>; messages: Array<Record<string, unknown>>; authorization: string | null }> = []
  const server = Bun.serve<{ authorization: string | null }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, srv) {
      const authorization = request.headers.get('authorization')
      return srv.upgrade(request, { data: { authorization } }) ? undefined : new Response('ws only', { status: 400 })
    },
    websocket: {
      open(socket: ServerWebSocket<{ authorization: string | null }>) {
        connections.push({ socket, messages: [], authorization: socket.data.authorization })
      },
      message(socket: ServerWebSocket<{ authorization: string | null }>, raw: string | Buffer) {
        const connection = connections.find((entry) => entry.socket === socket)
        if (!connection) return
        connection.messages.push(JSON.parse(raw.toString()) as Record<string, unknown>)
      },
    },
  })
  return {
    url: `ws://127.0.0.1:${server.port}`,
    connections,
    stop: () => server.stop(true),
    send(index: number, payload: Record<string, unknown>) {
      connections[index]!.socket.send(JSON.stringify(payload))
    },
    closeConnection(index: number) {
      connections[index]!.socket.close(1006, 'fixture-drop')
    },
  }
}

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

// Real loopback WebSocket I/O cannot be advanced by fake timers: the fixture and
// the client exchange frames on the platform event loop, so we poll the real
// observable state. The wait is bounded and each test asserts the exact frame.
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

function collect() {
  const audio: Uint8Array[] = []
  const transcripts: Array<{ role: string; text: string; isFinal: boolean }> = []
  const clears: string[] = []
  let ready = 0
  let errors: Error[] = []
  const callbacks = {
    onAudio: (chunk: Uint8Array) => audio.push(chunk),
    onClearAudio: (reason: 'barge-in') => clears.push(reason),
    onTranscript: (role: 'user' | 'assistant', text: string, isFinal: boolean) => transcripts.push({ role, text, isFinal }),
    onReady: () => { ready += 1 },
    onError: (error: Error) => errors.push(error),
  }
  return { callbacks, audio, transcripts, clears, get ready() { return ready }, get errors() { return errors } }
}

describe('OpenAI realtime voice bridge protocol', () => {
  it('handshakes, frames audio, relays transcripts and clears playback on barge-in', async () => {
    const wire = fixture()
    cleanups.push(() => wire.stop())
    const provider = createOpenAiRealtimeVoiceProvider({ apiKey: 'test-key', wsUrl: wire.url, openSocket: openGlobalWebSocket, connectTimeoutMs: 1_000 })
    const sink = collect()
    const bridge = await provider.createBridge(sink.callbacks, { sessionId: 'talk-1', voice: 'alloy', instructions: 'be brief' })
    cleanups.push(() => bridge.close())

    await until(() => wire.connections.length === 1 && wire.connections[0]!.messages.length >= 1)
    const handshake = wire.connections[0]!.messages[0]!
    expect(handshake.type).toBe('session.update')
    expect((handshake.session as Record<string, unknown>).output_audio_format).toBe('pcm16')
    expect(wire.connections[0]!.authorization).toBe('Bearer test-key')
    await until(() => sink.ready === 1)

    bridge.sendAudio(Uint8Array.from([1, 2, 3]))
    await until(() => wire.connections[0]!.messages.some((message) => message.type === 'input_audio_buffer.append'))
    const append = wire.connections[0]!.messages.find((message) => message.type === 'input_audio_buffer.append')!
    expect(append.audio).toBe(Buffer.from([1, 2, 3]).toString('base64'))

    wire.send(0, { type: 'response.audio.delta', delta: Buffer.from([9, 8]).toString('base64') })
    wire.send(0, { type: 'response.audio_transcript.delta', delta: 'при' })
    wire.send(0, { type: 'response.audio_transcript.done', transcript: 'привет' })
    await until(() => sink.audio.length === 1 && sink.transcripts.length === 2)
    expect(Array.from(sink.audio[0]!)).toEqual([9, 8])
    expect(sink.transcripts).toEqual([
      { role: 'assistant', text: 'при', isFinal: false },
      { role: 'assistant', text: 'привет', isFinal: true },
    ])

    // Local barge-in cancels the provider response.
    bridge.handleBargeIn()
    await until(() => wire.connections[0]!.messages.some((message) => message.type === 'response.cancel'))
    expect(sink.clears).toEqual(['barge-in'])

    // Server-side VAD detecting user speech also clears playback.
    wire.send(0, { type: 'input_audio_buffer.speech_started' })
    await until(() => sink.clears.length === 2)
    expect(sink.clears).toEqual(['barge-in', 'barge-in'])
  })

  it('reconnects with backoff after an unexpected socket drop', async () => {
    const wire = fixture()
    cleanups.push(() => wire.stop())
    const provider = createOpenAiRealtimeVoiceProvider({ apiKey: 'test-key', wsUrl: wire.url, openSocket: openGlobalWebSocket, baseDelayMs: 10, connectTimeoutMs: 1_000 })
    const sink = collect()
    const bridge = await provider.createBridge(sink.callbacks, { sessionId: 'talk-2' })
    cleanups.push(() => bridge.close())
    await until(() => sink.ready === 1)

    wire.closeConnection(0)
    await until(() => wire.connections.length === 2)
    await until(() => wire.connections[1]!.messages.length >= 1)
    expect(wire.connections[1]!.messages[0]!.type).toBe('session.update')
    await until(() => sink.ready === 2)
  })

  it('is unconfigured without a key', () => {
    expect(createOpenAiRealtimeVoiceProvider({}).isConfigured()).toBe(false)
    expect(createOpenAiRealtimeVoiceProvider({ apiKey: 'k' }).isConfigured()).toBe(true)
    expect(() => createOpenAiRealtimeTranscriptionSession({})).toThrow(/not configured/)
  })
})

describe('OpenAI realtime transcription relay', () => {
  it('handshakes for transcription and normalizes provider frames', async () => {
    const wire = fixture()
    cleanups.push(() => wire.stop())
    const session = createOpenAiRealtimeTranscriptionSession({ apiKey: 'test-key', wsUrl: wire.url, openSocket: openGlobalWebSocket, connectTimeoutMs: 1_000, baseDelayMs: 10 })
    cleanups.push(() => session.close())
    const partial: string[] = []
    const finals: Array<[string, boolean]> = []
    let speechStarts = 0
    session.onPartial((text) => partial.push(text))
    session.onTranscript((text, final) => finals.push([text, final]))
    session.onSpeechStart(() => { speechStarts += 1 })

    await session.connect()
    await until(() => wire.connections.length === 1 && wire.connections[0]!.messages.length >= 1)
    const handshake = wire.connections[0]!.messages[0]!
    expect(handshake.type).toBe('session.update')
    const config = handshake.session as Record<string, unknown>
    expect((config.input_audio_transcription as Record<string, unknown>).model).toBe('gpt-4o-transcribe')
    expect(wire.connections[0]!.authorization).toBe('Bearer test-key')

    session.sendAudio(Uint8Array.from([4, 5]))
    await until(() => wire.connections[0]!.messages.some((message) => message.type === 'input_audio_buffer.append'))

    wire.send(0, { type: 'input_audio_buffer.speech_started' })
    wire.send(0, { type: 'conversation.item.input_audio_transcription.delta', delta: 'прив' })
    wire.send(0, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'привет' })
    await until(() => finals.length === 1 && partial.length === 1 && speechStarts === 1)
    expect(partial).toEqual(['прив'])
    expect(finals).toEqual([['привет', true]])
  })
})