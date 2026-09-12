import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerVoiceHandlers } from '../voice'
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
  it('returns disarmed local defaults', async () => {
    const handlers = createHarness()
    const prefs = await handlers.get(RPC_CHANNELS.voice.GET)!({})
    expect(prefs).toMatchObject({
      sttEngine: 'local-whisper',
      ttsEngine: 'edge',
      wakeWordEnabled: false,
      alwaysListeningConsent: false,
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

  it('refuses local transcription when the Whisper model is missing', async () => {
    const handlers = createHarness()
    await expect(handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: Buffer.from('abc').toString('base64'),
      mimeType: 'audio/webm',
    })).rejects.toThrow(/not installed/)
  })
})
