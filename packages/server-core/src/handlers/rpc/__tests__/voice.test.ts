import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerVoiceHandlers } from '../voice'
import type { RpcServer } from '@craft-agent/server-core/transport'

type Handler = (ctx: unknown, ...args: unknown[]) => unknown | Promise<unknown>

function createHarness(runtime?: Parameters<typeof registerVoiceHandlers>[2]) {
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
  const configDir = runtime?.configDir ?? mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
  registerVoiceHandlers(server as unknown as RpcServer, {
    platform: { logger: console },
  } as never, {
    ...runtime,
    configDir,
    gatewayDeps: runtime?.gatewayDeps ?? {
      fetch: async () => new Response('{}', { status: 404 }),
      configDir,
      env: {},
    },
  })
  return handlers
}

describe('voice RPC', () => {
  it('returns disarmed cloud defaults', async () => {
    const handlers = createHarness()
    const prefs = await handlers.get(RPC_CHANNELS.voice.GET)!({})
    expect(prefs).toMatchObject({
      sttEngine: 'cloud-rox',
      ttsEngine: 'edge',
      audioRetention: 'session',
      wakeWordEnabled: false,
      alwaysListeningConsent: false,
      overlayPosition: 'top',
      recognitionLanguage: 'auto',
      delivery: 'draft',
      trailingSpace: false,
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
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({ configDir: dir })
    await handlers.get(RPC_CHANNELS.voice.SAVE)!({}, {
      sttEngine: 'local-whisper',
      whisperStatus: 'ready',
    })
    await expect(handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: Buffer.from('abc').toString('base64'),
      mimeType: 'audio/webm',
    })).rejects.toThrow(/not installed/)
  })

  it('does not treat a local fixture as a production transcript', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      localModelReady: () => true,
    })
    await handlers.get(RPC_CHANNELS.voice.SAVE)!({}, {
      sttEngine: 'local-whisper',
      whisperStatus: 'ready',
    })
    await expect(handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: Buffer.from('abc').toString('base64'),
      mimeType: 'audio/webm',
    })).rejects.toThrow(/not installed/)
  })

  it('does not treat a manual transcript field as ASR output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({
        text: 'model output',
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const result = await handlers.get(RPC_CHANNELS.voice.TRANSCRIBE)!({}, {
      audioBase64: Buffer.from('abc').toString('base64'),
      mimeType: 'audio/webm',
      transcript: 'human override',
    }) as { text: string }
    expect(result.text).toBe('model output')
  })

  it('journals capture chunks independently of transcribe payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async ({ audio }) => ({
        text: `bytes:${audio.length}`,
        engine: 'cloud-rox',
        uploaded: true,
      }),
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    const result = await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, {
      id: started.id,
    }) as { text: string }
    expect(result.text).toBe('bytes:3')
    const listed = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as Array<{ status: string }>
    expect(listed[0]?.status).toBe('complete')
  })

  it('delete is an explicit action and does not run on cancel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({ text: 'kept', engine: 'cloud-rox', uploaded: true }),
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CANCEL)!({}, { id: started.id })
    const listed = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as Array<{ id: string; status: string }>
    expect(listed[0]?.status).toBe('canceled')
    await handlers.get(RPC_CHANNELS.voice.DELETE)!({}, { id: started.id })
    const after = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as unknown[]
    expect(after).toHaveLength(0)
  })

  it('returns recording audio without a filesystem path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({ text: 'ok', engine: 'cloud-rox', uploaded: true }),
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('wav-bytes').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, {
      id: started.id,
      durationMs: 900,
    })
    const audio = await handlers.get(RPC_CHANNELS.voice.GET_AUDIO)!({}, { id: started.id }) as {
      mimeType: string
      audioBase64: string
    }
    expect(audio.mimeType).toBe('audio/webm')
    expect(Buffer.from(audio.audioBase64, 'base64').toString()).toBe('wav-bytes')
    expect(JSON.stringify(audio)).not.toContain('audioPath')
    const listed = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as Array<{ durationMs?: number }>
    expect(listed[0]?.durationMs).toBe(900)
  })

  it('retranscribes without overwriting the first ASR revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    let pass = 0
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => {
        pass += 1
        return { text: `pass-${pass}`, engine: 'cloud-rox', uploaded: true }
      },
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, { id: started.id })
    await handlers.get(RPC_CHANNELS.voice.RETRANSCRIBE)!({}, { id: started.id })
    const listed = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as Array<{
      result?: { text?: string }
      revisions?: Array<{ id: string; text: string }>
      selectedRevisionId?: string
    }>
    expect(listed[0]?.revisions).toHaveLength(2)
    expect(listed[0]?.revisions?.[0]?.text).toBe('pass-1')
    expect(listed[0]?.result?.text).toBe('pass-2')

    const selected = await handlers.get(RPC_CHANNELS.voice.SELECT_REVISION)!({}, {
      id: started.id,
      revisionId: listed[0]!.revisions![0]!.id,
    }) as { result?: { text?: string }; selectedRevisionId?: string }
    expect(selected.result?.text).toBe('pass-1')
    expect(selected.selectedRevisionId).toBe(listed[0]!.revisions![0]!.id)

    const exported = await handlers.get(RPC_CHANNELS.voice.EXPORT)!({}, {
      id: started.id,
      format: 'txt',
    }) as { path: string }
    expect(readFileSync(exported.path, 'utf8')).toBe('pass-1')
  })

  it('sends the saved recognition language on capture stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const languages: Array<string | undefined> = []
    const handlers = createHarness({
      configDir: dir,
      transcribe: async (input) => {
        languages.push(input.language)
        return { text: 'ok', engine: 'cloud-rox', uploaded: true }
      },
    })
    await handlers.get(RPC_CHANNELS.voice.SAVE)!({}, { recognitionLanguage: 'ru' })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, { id: started.id })
    expect(languages).toEqual(['ru'])
  })

  it('refuses SRT export when the selected revision has no timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({ text: 'plain', engine: 'cloud-rox', uploaded: true }),
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, { id: started.id })
    await expect(handlers.get(RPC_CHANNELS.voice.EXPORT)!({}, {
      id: started.id,
      format: 'srt',
    })).rejects.toThrow('SRT export needs timestamped ASR output')
  })

  it('edits a transcript as a manual revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({ text: 'model output', engine: 'cloud-rox', uploaded: true }),
    })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, { id: started.id })
    const edited = await handlers.get(RPC_CHANNELS.voice.EDIT_TRANSCRIPT)!({}, {
      id: started.id,
      text: 'fixed wording',
    }) as { result?: { text?: string; segments?: unknown }; revisions?: Array<{ kind: string }> }
    expect(edited.result?.text).toBe('fixed wording')
    expect(edited.result?.segments).toBeUndefined()
    expect(edited.revisions?.[1]?.kind).toBe('manual')
  })

  it('discards capture audio when retention is none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-voice-rpc-'))
    const handlers = createHarness({
      configDir: dir,
      transcribe: async () => ({ text: 'ok', engine: 'cloud-rox', uploaded: true }),
    })
    await handlers.get(RPC_CHANNELS.voice.SAVE)!({}, { audioRetention: 'none' })
    const started = await handlers.get(RPC_CHANNELS.voice.CAPTURE_START)!({}, {
      mimeType: 'audio/webm',
    }) as { id: string }
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_CHUNK)!({}, {
      id: started.id,
      chunkBase64: Buffer.from('abc').toString('base64'),
    })
    await handlers.get(RPC_CHANNELS.voice.CAPTURE_STOP)!({}, { id: started.id })
    const listed = await handlers.get(RPC_CHANNELS.voice.LIST)!({}) as Array<{ audioAvailable?: boolean }>
    expect(listed[0]?.audioAvailable).toBe(false)
    await expect(handlers.get(RPC_CHANNELS.voice.GET_AUDIO)!({}, { id: started.id })).rejects.toThrow(
      'Audio was discarded by retention policy',
    )
  })
})
