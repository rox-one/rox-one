import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerVoiceHandlers, HANDLED_CHANNELS } from '../voice'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { getDefaultVoicePrefs } from '@craft-agent/shared/voice'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness(options: Parameters<typeof registerVoiceHandlers>[2] = {}) {
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
  } as never, options)
  return handlers
}

describe('voice RPC', () => {
  it('returns synthesized MP3 for client playback without starting system speech', async () => {
    let nativeCalls = 0
    const handlers = createHarness({
      loadPrefs: () => ({ ...getDefaultVoicePrefs(), recognitionLanguage: 'ru' }),
      edgeSpeaker: { engine: 'edge', async speak(input) {
        expect(input.language).toBe('ru')
        return { engine: 'edge', uploaded: false, textSent: true, audioBase64: 'bXAz', mimeType: 'audio/mpeg' }
      } },
      systemSpeaker: { stop: () => false, isSpeaking: () => false, async speak() { nativeCalls++; return { played: true } } },
    })
    expect(await handlers.get(RPC_CHANNELS.voice.SPEAK)!({}, { text: 'Привет' })).toMatchObject({
      engine: 'edge', playback: 'audio', audioBase64: 'bXAz', mimeType: 'audio/mpeg', textSent: true,
    })
    expect(nativeCalls).toBe(0)
  })

  it('falls back to system playback when edge synthesis fails', async () => {
    const handlers = createHarness({
      loadPrefs: getDefaultVoicePrefs,
      edgeSpeaker: { engine: 'edge', async speak() { throw new Error('offline') } },
      systemSpeaker: { stop: () => false, isSpeaking: () => true, async speak() { return { played: true } } },
    })
    expect(await handlers.get(RPC_CHANNELS.voice.SPEAK)!({}, { text: 'hello' })).toMatchObject({ playback: 'native', engine: 'macos-say' })
    expect(await handlers.get(RPC_CHANNELS.voice.SPEAK)!({}, { status: true })).toMatchObject({ speaking: true })
  })

  it('stop cancels pending synthesis without starting fallback speech', async () => {
    let nativeCalls = 0
    const handlers = createHarness({
      loadPrefs: getDefaultVoicePrefs,
      edgeSpeaker: { engine: 'edge', speak(input) {
        return new Promise((_, reject) => input.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
      } },
      systemSpeaker: { stop: () => false, isSpeaking: () => false, async speak() { nativeCalls++; return { played: true } } },
    })
    const speak = handlers.get(RPC_CHANNELS.voice.SPEAK)!
    const pending = speak({}, { text: 'hello' })
    expect(await speak({}, { stop: true })).toMatchObject({ stopped: true })
    expect(await pending).toMatchObject({ playback: 'none' })
    expect(nativeCalls).toBe(0)
  })

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
      ttsEngine: 'system',
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

  it('does not let body.transcript override ASR and never returns a fixture phrase', async () => {
    const handlers = createHarness()
    const wav = Buffer.alloc(44)
    wav.write('RIFF', 0)
    wav.write('WAVE', 8)
    await expect(handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: wav.toString('base64'),
      mimeType: 'audio/wav',
      transcript: 'injected by the renderer',
    })).rejects.toThrow(/Enable cloud ASR consent or select local Whisper/)
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
