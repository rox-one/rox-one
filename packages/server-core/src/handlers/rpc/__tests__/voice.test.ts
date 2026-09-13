import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerVoiceHandlers, HANDLED_CHANNELS } from '../voice'
import type { RpcServer } from '@craft-agent/server-core/transport'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const server = {
    handle(channel: string, handler: Handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  registerVoiceHandlers(server as unknown as RpcServer, {
    platform: { logger: console },
  } as never)
  return handlers
}

describe('voice RPC', () => {
  it('registers the v2 host, history and capabilities channels', () => {
    const handlers = createHarness()
    for (const channel of HANDLED_CHANNELS) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('returns cloud-rox defaults with wake word disarmed', async () => {
    const handlers = createHarness()
    const prefs = await handlers.get(RPC_CHANNELS.voice.GET)!({})
    expect(prefs).toMatchObject({
      sttEngine: 'cloud-rox',
      asrModelId: 'rocks-t1',
      ttsEngine: 'edge',
      wakeWordEnabled: false,
      alwaysListeningConsent: false,
      autoSubmit: false,
    })
  })

  it('does not arm wake word without consent', async () => {
    const handlers = createHarness()
    const saved = await handlers.get(RPC_CHANNELS.voice.SAVE)!({}, {
      wakeWordEnabled: true,
      alwaysListeningConsent: false,
    })
    expect(saved).toMatchObject({
      wakeWordEnabled: false,
      alwaysListeningConsent: false,
    })
  })

  it('does not let body.transcript override ASR', async () => {
    const handlers = createHarness()
    const wav = Buffer.alloc(44)
    wav.write('RIFF', 0)
    wav.write('WAVE', 8)
    const result = await handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: wav.toString('base64'),
      mimeType: 'audio/wav',
      transcript: 'injected by the renderer',
    }) as { text: string }
    expect(result.text).not.toBe('injected by the renderer')
    expect(result.text).toBe('rox cloud dictation')
  })

  it('lists the three local model families without claiming they are ready', async () => {
    const handlers = createHarness()
    const listed = await handlers.get(RPC_CHANNELS.voice.MODELS_LIST)!({}) as { families: string[]; selected: string }
    expect(listed.families).toEqual([
      'whisper-large-v3-turbo',
      'nemotron-3.5-asr-streaming-0.6b',
      'gigaam-v3-e2e-rnnt',
    ])
    expect(listed.selected).toBe('whisper-large-v3-turbo')
  })

  it('reports scaffold health on the CI fixture path and does not claim live ASR', async () => {
    const previous = process.env.CRAFT_VOICE_GATEWAY_FIXTURE
    process.env.CRAFT_VOICE_GATEWAY_FIXTURE = '1'
    try {
      const handlers = createHarness()
      const health = await handlers.get(RPC_CHANNELS.voice.HEALTH)!({}) as { evidenceClass: string }
      expect(health.evidenceClass).toBe('scaffold')
    } finally {
      if (previous === undefined) delete process.env.CRAFT_VOICE_GATEWAY_FIXTURE
      else process.env.CRAFT_VOICE_GATEWAY_FIXTURE = previous
    }
  })
})
