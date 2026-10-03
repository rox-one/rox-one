import { describe, expect, it } from 'bun:test'
import { DeepgramTranscriptionAdapter, latestNovaModel, normalizeDeepgramTranscript } from '../adapters/deepgram-transcription.ts'
import { normalizeVoicePrefs } from '../storage.ts'

function response() {
  return {
    metadata: { request_id: 'synthetic-request', duration: 8.25,
      model_info: { model: { name: '3-general-nova', arch: 'nova-3', version: 'synthetic-latest' } },
      diarize_info: { arch: 'v2' } },
    results: { channels: [{ detected_language: 'ru', alternatives: [{ transcript: 'Первый абзац. Второй абзац.',
      words: [{ start: 1.25, end: 2, word: 'Первый', punctuated_word: 'Первый', speaker: 0 },
        { start: 4, end: 5.5, word: 'Второй', punctuated_word: 'Второй', speaker: 1 }],
      paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ start: 1.25, end: 2.5, text: 'Первый абзац.' }] },
        { speaker: 1, sentences: [{ start: 4, end: 6, text: 'Второй абзац.' }] }] },
    }] }] },
  }
}
const audio = new Uint8Array(44)
audio.set([82, 73, 70, 70])
audio.set([87, 65, 86, 69], 8)

describe('Deepgram current prerecorded transcription', () => {
  it('selects the latest released Nova general batch model, ignoring specialty/streaming models', () => {
    expect(latestNovaModel({ stt: [
      { canonical_name: 'nova-3-general', batch: true },
      { canonical_name: 'nova-4-general', batch: true },
      { canonical_name: 'nova-5', batch: false },
      { canonical_name: 'nova-6', batch: true, retired: true },
      { canonical_name: 'nova-7-medical', batch: true },
      { canonical_name: 'flux-general-multi', batch: false },
    ] })).toBe('nova-4')
    expect(latestNovaModel({ stt: [] })).toBe('nova-3')
    expect(latestNovaModel(null)).toBe('nova-3')
  })

  it('normalizes diarized paragraphs and timestamps without losing actual model provenance', () => {
    expect(normalizeDeepgramTranscript(response())).toMatchObject({
      text: 'Первый абзац.\n\nВторой абзац.', durationMs: 8250, detectedLanguage: 'ru', noSpeech: false,
      requestedModelId: 'nova-3', resolvedModelId: 'nova-3', modelRevision: 'synthetic-latest', diarizationModel: 'v2',
      segments: [{ startMs: 1250, endMs: 2500, speakerId: 'speaker-1' }, { startMs: 4000, endMs: 6000, speakerId: 'speaker-2' }],
      words: [{ startMs: 1250, endMs: 2000, speakerId: 'speaker-1' }, { startMs: 4000, endMs: 5500, speakerId: 'speaker-2' }],
    })
  })

  it('infers paragraph speakers from diarized words if paragraph fields are omitted', () => {
    const raw = response()
    Reflect.deleteProperty(raw.results.channels[0]!.alternatives[0]!.paragraphs.paragraphs[0]!, 'speaker')
    expect(normalizeDeepgramTranscript(raw).segments[0]?.speakerId).toBe('speaker-1')
  })

  it('uses utterances when paragraphs are absent and reports silence without fabricated text', () => {
    const raw = response() as Record<string, any>
    delete raw.results.channels[0].alternatives[0].paragraphs
    raw.results.utterances = [{ start: 1.25, end: 2.5, transcript: 'Первый абзац.', speaker: 0 }]
    expect(normalizeDeepgramTranscript(raw).segments).toHaveLength(1)
    expect(normalizeDeepgramTranscript({ metadata: { duration: 1.4 }, results: { channels: [{ alternatives: [{ transcript: '', words: [] }] }] } }))
      .toMatchObject({ text: '', segments: [], noSpeech: true, durationMs: 1400 })
  })

  it.each(['negative', 'reversed', 'non-monotonic', 'beyond-duration', 'invalid-word', 'invalid-duration'])('rejects damaged %s timestamps', (kind) => {
    const raw = response() as Record<string, any>
    const paragraphs = raw.results.channels[0].alternatives[0].paragraphs.paragraphs
    if (kind === 'negative') paragraphs[0].sentences[0].start = -1
    if (kind === 'reversed') paragraphs[0].sentences[0].end = 0
    if (kind === 'non-monotonic') paragraphs[1].sentences[0].start = 0.5
    if (kind === 'beyond-duration') paragraphs[1].sentences[0].end = 10
    if (kind === 'invalid-word') raw.results.channels[0].alternatives[0].words[0].start = '1.25'
    if (kind === 'invalid-duration') raw.metadata.duration = '8.25'
    expect(() => normalizeDeepgramTranscript(raw)).toThrow()
  })

  it('posts one audio body with latest ASR and latest diarizer, paragraphs and explicit language', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-key', http: { async fetch(url, init) {
      calls.push({ url, init })
      return new Response(JSON.stringify(url.endsWith('/models') ? { stt: [{ canonical_name: 'nova-3-general', batch: true }] } : response()))
    } } })
    const result = await adapter.transcribe({ audio, mimeType: 'audio/wav', language: 'ru' })
    expect(calls).toHaveLength(2)
    const transcription = calls[1]!
    const query = new URL(transcription.url).searchParams
    expect(Object.fromEntries(query)).toEqual({ model: 'nova-3', version: 'latest', smart_format: 'true', punctuate: 'true',
      diarize_model: 'latest', paragraphs: 'true', utterances: 'true', language: 'ru' })
    expect(query.has('diarize')).toBe(false)
    expect(transcription.init?.method).toBe('POST')
    expect(transcription.init?.headers).toMatchObject({ Authorization: 'Token synthetic-key', 'Content-Type': 'audio/wav' })
    expect((transcription.init?.body as Blob).size).toBe(audio.length)
    expect(result.diarizationModel).toBe('v2')
  })

  it('catalog failure uses current Nova with auto language without falling back to another provider', async () => {
    const urls: string[] = []
    const adapter = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-key', http: { async fetch(url) {
      urls.push(url)
      return url.endsWith('/models') ? new Response('', { status: 403 }) : new Response(JSON.stringify(response()))
    } } })
    await adapter.transcribe({ audio, mimeType: 'audio/wav; codecs=pcm', language: 'auto' })
    expect(new URL(urls[1]!).searchParams.get('detect_language')).toBe('true')
    expect(new URL(urls[1]!).searchParams.get('model')).toBe('nova-3')
    expect(urls.every((url) => new URL(url).origin === 'https://api.deepgram.com')).toBe(true)
  })

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [413, 'too-large'], [429, 'rate-limited'], [503, 'upstream']])('sanitizes provider errors %s', async (status, code) => {
    const adapter = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-key', model: 'nova-3', http: { async fetch() {
      return new Response('private-provider-body synthetic-key', { status: Number(status) })
    } } })
    try { await adapter.transcribe({ audio, mimeType: 'audio/wav' }); throw new Error('Expected failure') } catch (error) {
      expect(error).toMatchObject({ code })
      expect(String(error)).not.toContain('synthetic-key')
      expect(String(error)).not.toContain('private-provider-body')
    }
  })

  it('cancels before upload and while catalog discovery is in flight', async () => {
    const first = new AbortController(); first.abort()
    let called = 0
    const adapter = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-key', http: { async fetch() { called++; return new Response('{}') } } })
    await expect(adapter.transcribe({ audio, signal: first.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(called).toBe(0)
    const second = new AbortController()
    const discovering = new DeepgramTranscriptionAdapter({ apiKey: 'synthetic-key', http: { async fetch() {
      second.abort(); return new Response('{}')
    } } })
    await expect(discovering.transcribe({ audio, signal: second.signal })).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('replaces obsolete cloud model identifiers while preserving consent and explicit local models', () => {
    expect(normalizeVoicePrefs({ version: 3, sttEngine: 'cloud-rox', asrModelId: 'rocks-t1', cloudAsrConsent: true }))
      .toMatchObject({ asrModelId: 'nova-3', cloudAsrConsent: true })
    expect(normalizeVoicePrefs({ version: 3, sttEngine: 'local-whisper', asrModelId: 'gigaam-v3-e2e-rnnt' }).asrModelId).toBe('gigaam-v3-e2e-rnnt')
  })
})
