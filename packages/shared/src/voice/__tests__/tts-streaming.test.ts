import { describe, expect, it } from 'bun:test'
import { createTtsStream, iterateTtsChunks, sliceAudioChunks } from '../tts/streaming.ts'
import { resolveTtsProviderId } from '../tts/resolution.ts'
import { synthesizeSpeech } from '../tts/synthesis.ts'
import type { SpeechProvider, SpeechSynthesisResult } from '../provider-registry.ts'

const result = (bytes: number[]): SpeechSynthesisResult => ({
  audioBuffer: Uint8Array.from(bytes),
  outputFormat: 'mp3',
  fileExtension: 'mp3',
  voiceCompatible: true,
})

describe('tts chunking', () => {
  it('slices a buffer into bounded chunks and keeps the tail', () => {
    const slices = sliceAudioChunks(Uint8Array.from({ length: 10 }, (_, index) => index), 4)
    expect(slices.map((slice) => slice.byteLength)).toEqual([4, 4, 2])
    expect(sliceAudioChunks(new Uint8Array())).toEqual([])
    expect(() => sliceAudioChunks(new Uint8Array([1]), 0)).toThrow()
  })

  it('streams ordered chunks with only the last marked final', async () => {
    const buffer = Uint8Array.from({ length: 6 }, (_, index) => index + 1)
    const chunks = []
    for await (const chunk of iterateTtsChunks({ streamId: 's1', buffer, mimeType: 'audio/mpeg', chunkSize: 4 })) chunks.push(chunk)
    expect(chunks.map((chunk) => chunk.seq)).toEqual([1, 2])
    expect(chunks.map((chunk) => chunk.final)).toEqual([false, true])
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.audioBase64, 'base64')))).toEqual(Buffer.from(buffer))
  })

  it('stops iterating once the signal aborts', async () => {
    const controller = new AbortController()
    const seen: number[] = []
    for await (const chunk of iterateTtsChunks({ streamId: 's1', buffer: new Uint8Array(20), mimeType: 'audio/mpeg', chunkSize: 4, signal: controller.signal })) {
      seen.push(chunk.seq)
      if (seen.length === 2) controller.abort()
    }
    expect(seen).toEqual([1, 2])
  })
})

describe('cancellable tts stream', () => {
  it('synthesizes lazily and cancels mid-stream', async () => {
    let calls = 0
    const stream = createTtsStream({
      streamId: 's1',
      chunkSize: 4,
      synthesize: async (signal) => {
        calls += 1
        expect(signal.aborted).toBe(false)
        return result([1, 2, 3, 4, 5, 6, 7, 8])
      },
    })
    const seen: number[] = []
    for await (const chunk of stream) {
      seen.push(chunk.seq)
      if (seen.length === 1) stream.cancel('user-stop')
    }
    expect(calls).toBe(1)
    expect(stream.cancelled).toBe(true)
    expect(seen).toEqual([1])
  })

  it('never synthesizes when cancelled before iteration', async () => {
    let calls = 0
    const stream = createTtsStream({ streamId: 's1', synthesize: async () => { calls += 1; return result([1]) } })
    stream.cancel()
    const seen: unknown[] = []
    for await (const chunk of stream) seen.push(chunk)
    expect(seen).toEqual([])
    expect(calls).toBe(0)
  })
})

describe('tts provider resolution precedence', () => {
  it('honours preference, then persona, config, voice model, fallback', () => {
    const available = ['edge', 'system', 'openai']
    expect(resolveTtsProviderId({ preference: 'openai', persona: 'edge' }, available, 'system')).toBe('openai')
    expect(resolveTtsProviderId({ persona: 'edge', config: 'system' }, available, 'system')).toBe('edge')
    expect(resolveTtsProviderId({ config: 'openai' }, available, 'system')).toBe('openai')
    expect(resolveTtsProviderId({ voiceModel: 'system' }, available, 'edge')).toBe('system')
  })

  it('skips candidates that are not available and falls back deterministically', () => {
    expect(resolveTtsProviderId({ preference: 'missing' }, ['edge', 'system'], 'system')).toBe('system')
    expect(resolveTtsProviderId({}, ['edge', 'system'], 'missing')).toBe('edge')
    expect(() => resolveTtsProviderId({}, [], 'system')).toThrow()
  })
})

describe('buffered synthesis guard', () => {
  const provider = (produce: SpeechProvider['synthesize']): SpeechProvider => ({
    id: 'test', displayName: 'test', capabilities: { streaming: false, bargeIn: false, toolCalls: false, browserSession: false, languages: [] },
    isConfigured: () => true, synthesize: produce,
  })

  it('rejects empty text', async () => {
    await expect(synthesizeSpeech(provider(async () => result([1])), { text: '   ' })).rejects.toThrow(/empty/)
  })

  it('rejects an empty audio buffer', async () => {
    await expect(synthesizeSpeech(provider(async () => result([])), { text: 'hello' })).rejects.toThrow(/no audio/)
  })

  it('returns audio for a valid request', async () => {
    const output = await synthesizeSpeech(provider(async () => result([1, 2, 3])), { text: ' hello ' })
    expect(output.audioBuffer.byteLength).toBe(3)
  })
})