import { afterEach, describe, expect, it } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@rox/shared/protocol'
import { VoiceProviderError, getDefaultVoicePrefs, loadVoicePrefs, saveVoicePrefs, type RealtimeVoiceBridge, type RealtimeVoiceProvider, type SpeechProvider, type VoiceProviderCapabilities, type VoicePrefs } from '@rox/shared/voice'
import { registerVoiceRealtimeHandlers, VOICE_REALTIME_HANDLED_CHANNELS } from '../voice-realtime'
import type { RpcServer } from '@rox/server-core/transport'
import { WsRpcClient } from '../../../transport/client'
import { WsRpcServer } from '../../../transport/server'
import { deserializeEnvelope } from '../../../transport/codec'
import { NativeAuthority, type NativeIssuedCredential } from '../../../authority/native-authority'
import { NATIVE_CLIENT_EVENT_CHANNELS, NATIVE_EVENT_CHANNELS } from '../../../bootstrap/headless-start'

const TRANSPORT_TOKEN = 'voice-transport-token-enough-entropy'
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch { /* best-effort */ }
  }
})

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

const capabilities: VoiceProviderCapabilities = { streaming: true, bargeIn: true, toolCalls: true, browserSession: false, languages: ['en'] }

interface FakeBridge {
  bridge: RealtimeVoiceBridge
  sent: Uint8Array[]
  readonly closed: boolean
}

function fakeBridge(): FakeBridge {
  const sent: Uint8Array[] = []
  let closed = false
  const bridge: RealtimeVoiceBridge = {
    outputAudioMode: 'per-response',
    connect: async () => {},
    sendAudio: (chunk) => sent.push(chunk),
    sendUserMessage: () => {},
    submitToolResult: () => {},
    handleBargeIn: () => {},
    close: () => { closed = true },
  }
  return { bridge, sent, get closed() { return closed } }
}

function fakeRealtime(configured: boolean): { provider: RealtimeVoiceProvider; bridge: FakeBridge } {
  const bridge = fakeBridge()
  return {
    bridge,
    provider: {
      id: 'openai', displayName: 'OpenAI Realtime', capabilities,
      isConfigured: () => configured,
      createBridge: async () => bridge.bridge,
    },
  }
}

const fakeSpeech: SpeechProvider = {
  id: 'edge', displayName: 'Edge TTS', capabilities: { ...capabilities, browserSession: false },
  isConfigured: () => true,
  synthesize: async () => ({ audioBuffer: Uint8Array.from({ length: 10 }, (_, index) => index), outputFormat: 'mp3', fileExtension: 'mp3', voiceCompatible: true }),
}

function createHarness(options: {
  configDir?: string
  realtime?: RealtimeVoiceProvider
  speech?: SpeechProvider
  prefs?: VoicePrefs
  serviceKeys?: Record<string, string>
} = {}) {
  const handlers = new Map<string, Handler>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const server = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
    push(channel: string, _target: unknown, ...args: unknown[]) { pushes.push({ channel, args }) },
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const configDir = options.configDir ?? mkdtempSync(join(tmpdir(), 'voice-rt-'))
  registerVoiceRealtimeHandlers(server as unknown as RpcServer, { platform: { logger: console } } as never, {
    configDir,
    providers: {
      realtime: options.realtime ? [options.realtime] : [],
      speech: options.speech ? [options.speech] : [],
    },
    getServiceKey: (key) => options.serviceKeys?.[key],
    loadPrefs: () => options.prefs ?? loadVoicePrefs(configDir),
  })
  return { handlers, pushes }
}

async function until(check: () => boolean, spins = 500): Promise<void> {
  for (let index = 0; index < spins && !check(); index += 1) await Promise.resolve()
  expect(check()).toBe(true)
}

describe('voice realtime RPC', () => {
  it('registers every declared channel', () => {
    const { handlers } = createHarness()
    for (const channel of VOICE_REALTIME_HANDLED_CHANNELS) expect(handlers.has(channel)).toBe(true)
  })

  it('lists configured providers without leaking credentials', async () => {
    const { handlers } = createHarness({ realtime: fakeRealtime(true).provider, speech: fakeSpeech })
    const result = await handlers.get(RPC_CHANNELS.voice.PROVIDERS)!({}) as { realtime: unknown[]; speech: unknown[] }
    expect(result.realtime).toEqual([{ id: 'openai', kind: 'realtime', displayName: 'OpenAI Realtime', configured: true, capabilities }])
    expect(result.speech[0]).toMatchObject({ id: 'edge', kind: 'speech', configured: true })
  })

  it('round-trips the wake list through wakeSet/wakeGet and pushes wakeChanged', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'voice-wake-'))
    saveVoicePrefs({ ...getDefaultVoicePrefs(), wakeWordEnabled: true, alwaysListeningConsent: true }, configDir)
    const harness = createHarness({ configDir })
    const set = await harness.handlers.get(RPC_CHANNELS.voice.WAKE_SET)!({}, { enabled: true, names: ['  Рокс ', 'Рокс', 'Rox'] })
    expect(set).toEqual({ enabled: true, names: ['Рокс', 'Rox'] })
    const changed = harness.pushes.find((entry) => entry.channel === RPC_CHANNELS.voice.WAKE_CHANGED)
    expect(changed?.args[0]).toEqual({ enabled: true, names: ['Рокс', 'Rox'] })
    expect(await harness.handlers.get(RPC_CHANNELS.voice.WAKE_GET)!({})).toEqual({ enabled: true, names: ['Рокс', 'Rox'] })
  })

  it('keeps wake disabled without always-listening consent', async () => {
    const harness = createHarness({ prefs: getDefaultVoicePrefs() })
    const set = await harness.handlers.get(RPC_CHANNELS.voice.WAKE_SET)!({}, { enabled: true, names: ['Рокс'] })
    expect(set).toEqual({ enabled: false, names: ['Рокс'] })
  })

  it('routes a known wake trigger and rejects an unknown one', async () => {
    const harness = createHarness({ prefs: { ...getDefaultVoicePrefs(), wakeWordEnabled: true, alwaysListeningConsent: true } })
    await harness.handlers.get(RPC_CHANNELS.voice.WAKE_SET)!({}, { names: ['Рокс'] })
    harness.pushes.length = 0
    await harness.handlers.get(RPC_CHANNELS.voice.TRIGGER)!({}, { name: 'рокс' })
    expect(harness.pushes.find((entry) => entry.channel === RPC_CHANNELS.voice.TRIGGER)?.args[0]).toMatchObject({ trigger: 'Рокс', routing: 'session' })
    await expect(harness.handlers.get(RPC_CHANNELS.voice.TRIGGER)!({}, { name: 'нет такого' })).rejects.toThrow(/unknown wake trigger/i)
  })

  it('fails talkStart with a typed unconfigured error when no realtime provider is set', async () => {
    const harness = createHarness({ realtime: fakeRealtime(false).provider })
    let error: unknown
    try { await harness.handlers.get(RPC_CHANNELS.voice.TALK_START)!({}, {}) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(VoiceProviderError)
    expect((error as VoiceProviderError).code).toBe('unconfigured')
  })

  it('drives a talk session: start, audio, events and stop', async () => {
    const { provider, bridge } = fakeRealtime(true)
    const harness = createHarness({ realtime: provider })
    const started = await harness.handlers.get(RPC_CHANNELS.voice.TALK_START)!({}, { mode: 'realtime', voice: 'alloy' }) as { sessionId: string }
    expect(started.sessionId).toBeTruthy()
    const events = harness.pushes.filter((entry) => entry.channel === RPC_CHANNELS.voice.TALK_EVENT)
    expect(events[0]?.args[0]).toMatchObject({ type: 'session.started', sessionId: started.sessionId, provider: 'openai' })
    await harness.handlers.get(RPC_CHANNELS.voice.TALK_AUDIO)!({}, { audioBase64: Buffer.from([1, 2]).toString('base64') })
    expect(bridge.sent).toEqual([Uint8Array.from([1, 2])])
    await harness.handlers.get(RPC_CHANNELS.voice.TALK_STOP)!({})
    expect(bridge.closed).toBe(true)
    const last = harness.pushes.filter((entry) => entry.channel === RPC_CHANNELS.voice.TALK_EVENT).at(-1)
    expect(last?.args[0]).toMatchObject({ type: 'session.ended' })
  })

  it('rejects talkClientSecret for a provider without browser sessions', async () => {
    const { provider } = fakeRealtime(true)
    const harness = createHarness({ realtime: provider })
    let error: unknown
    try { await harness.handlers.get(RPC_CHANNELS.voice.TALK_CLIENT_SECRET)!({}, {}) } catch (caught) { error = caught }
    expect((error as VoiceProviderError).code).toBe('unsupported')
  })

  it('fails sttStart with a typed unconfigured error without an OpenAI key', async () => {
    const harness = createHarness()
    let error: unknown
    try { await harness.handlers.get(RPC_CHANNELS.voice.STT_START)!({}, {}) } catch (caught) { error = caught }
    expect((error as VoiceProviderError).code).toBe('unconfigured')
  })

  it('synthesizes a TTS stream and pushes ordered chunks', async () => {
    const harness = createHarness({ speech: fakeSpeech })
    const started = await harness.handlers.get(RPC_CHANNELS.voice.TTS_STREAM_START)!({}, { text: 'Привет' }) as { streamId: string }
    expect(started.streamId).toBeTruthy()
    await until(() => harness.pushes.filter((entry) => entry.channel === RPC_CHANNELS.voice.TTS_STREAM_CHUNK).length === 1)
    const chunk = harness.pushes.find((entry) => entry.channel === RPC_CHANNELS.voice.TTS_STREAM_CHUNK)?.args[0] as { seq: number; final: boolean }
    expect(chunk).toMatchObject({ streamId: started.streamId, seq: 1, final: true })
    await harness.handlers.get(RPC_CHANNELS.voice.TTS_STREAM_STOP)!({}, { streamId: started.streamId })
  })
})

// ---------------------------------------------------------------------------
// Real transport round-trips (defect regressions: wire error codes + pushes).
// ---------------------------------------------------------------------------

function waitForEnvelope(
  ws: WebSocket,
  messages: MessageEnvelope[],
  matches: (message: MessageEnvelope) => boolean,
): Promise<MessageEnvelope> {
  const existing = messages.find(matches)
  if (existing) return Promise.resolve(existing)
  const { promise, resolve } = Promise.withResolvers<MessageEnvelope>()
  const onMessage = (data: WebSocket.RawData) => {
    const message = deserializeEnvelope(data.toString())
    if (!matches(message)) return
    ws.off('message', onMessage)
    resolve(message)
  }
  ws.on('message', onMessage)
  return promise
}

async function connectNativeClient(url: string, token: string) {
  const ws = new WebSocket(url)
  const messages: MessageEnvelope[] = []
  ws.on('message', (data: WebSocket.RawData) => messages.push(deserializeEnvelope(data.toString())))
  await once(ws, 'open')
  ws.send(JSON.stringify({
    id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId: 'workspace-a', token,
  }))
  const ack = await waitForEnvelope(ws, messages, (message) => message.id === 'handshake')
  return { ws, ack, messages }
}

describe('voice realtime transport round-trips', () => {
  it('preserves a typed VoiceProviderError code across a real RPC round-trip', async () => {
    const server = new WsRpcServer({
      host: '127.0.0.1', port: 0, requireAuth: true, serverId: 'voice-transport',
      validateToken: async (token) => token === TRANSPORT_TOKEN,
    })
    await server.listen()
    cleanups.push(() => server.close())
    server.handle(RPC_CHANNELS.voice.TALK_START, () => {
      throw new VoiceProviderError('unconfigured', 'No realtime voice provider is configured on this server')
    })

    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
      token: TRANSPORT_TOKEN, workspaceId: 'ws-a', autoReconnect: false,
    })
    client.connect()
    cleanups.push(() => client.destroy())
    await new Promise<void>((resolve, reject) => {
      const off = client.onConnectionStateChanged((state) => {
        if (state.status === 'connected') { off(); resolve() }
        else if (state.status === 'failed' || state.status === 'disconnected') {
          off(); reject(new Error(`status=${state.status}`))
        }
      })
    })

    let caught: unknown
    try { await client.invoke(RPC_CHANNELS.voice.TALK_START) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    const code = caught && typeof caught === 'object' && 'code' in caught ? caught.code : undefined
    expect(code).toBe('unconfigured')
  })

  it('delivers ttsStreamChunk and trigger pushes to a native principal through the allow-lists', async () => {
    // The headless-start allow-lists are the production gates; both channels must
    // be members or a native principal can never observe the push.
    expect(NATIVE_EVENT_CHANNELS.has(RPC_CHANNELS.voice.TTS_STREAM_CHUNK)).toBe(true)
    expect(NATIVE_EVENT_CHANNELS.has(RPC_CHANNELS.voice.TRIGGER)).toBe(true)
    expect(NATIVE_CLIENT_EVENT_CHANNELS.has(RPC_CHANNELS.voice.TTS_STREAM_CHUNK)).toBe(true)
    expect(NATIVE_CLIENT_EVENT_CHANNELS.has(RPC_CHANNELS.voice.TRIGGER)).toBe(true)

    const dir = mkdtempSync(join(tmpdir(), 'voice-push-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const authority = new NativeAuthority({ stateDir: join(dir, 'authority') })
    cleanups.push(() => authority.close())
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    let admin: NativeIssuedCredential
    try {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
      admin = authority.bootstrapLocalAdministrator('voice push owner')
    } finally {
      if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
      else Reflect.deleteProperty(process.stdin, 'isTTY')
    }
    const root = join(dir, 'workspace')
    mkdirSync(root)
    authority.registerWorkspace(admin.credential, 'workspace-a', root)
    const enrolled = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'voice-client', Date.now() + 60_000), 'voice-client')!
    authority.grantWorkspace(admin.credential, enrolled.principal.subject, 'workspace-a', ['read', 'subscribe'])

    const server = new WsRpcServer({
      host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
      validateToken: async () => true,
      nativeEventChannels: NATIVE_EVENT_CHANNELS,
      nativeClientEventChannels: NATIVE_CLIENT_EVENT_CHANNELS,
    })
    await server.listen()
    cleanups.push(() => server.close())

    const { ws, ack, messages } = await connectNativeClient(`ws://127.0.0.1:${server.port}`, enrolled.credential)
    cleanups.push(() => ws.terminate())
    expect(ack.type).toBe('handshake_ack')
    const clientId = ack.clientId
    if (typeof clientId !== 'string') throw new Error('handshake_ack did not carry a clientId')

    // Both channels are produced as client-targeted pushes (voice-realtime.ts);
    // membership in nativeEventChannels is what lets the native principal receive them.
    const chunk = { streamId: 'stream-1', seq: 1, mimeType: 'audio/mpeg', audioBase64: 'AA==', final: true }
    server.push(RPC_CHANNELS.voice.TTS_STREAM_CHUNK, { to: 'client', clientId }, chunk)
    const chunkEvent = await waitForEnvelope(ws, messages, (message) =>
      message.type === 'event' && message.channel === RPC_CHANNELS.voice.TTS_STREAM_CHUNK)
    expect(chunkEvent.args).toEqual([chunk])

    const trigger = { trigger: 'Рокс', routing: 'session', at: 1 }
    server.push(RPC_CHANNELS.voice.TRIGGER, { to: 'client', clientId }, trigger)
    const triggerEvent = await waitForEnvelope(ws, messages, (message) =>
      message.type === 'event' && message.channel === RPC_CHANNELS.voice.TRIGGER)
    expect(triggerEvent.args).toEqual([trigger])
  })
})