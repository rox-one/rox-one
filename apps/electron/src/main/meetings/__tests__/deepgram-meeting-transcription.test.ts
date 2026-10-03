import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMeetingStore } from '../local-store'
import type { NormalizedTranscript } from '@rox/shared/voice'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const engine = { ready: true, engine: 'deepgram', binary: null, model: 'nova-3', modelPath: null, ffmpeg: null, missing: [] }
const transcript: NormalizedTranscript = {
  text: 'Hello.\n\nПривет.', segments: [{ startMs: 250, endMs: 1500, text: 'Hello.', speakerId: 'speaker-1' },
    { startMs: 2250, endMs: 4000, text: 'Привет.', speakerId: 'speaker-2' }],
  requestedModelId: 'nova-3', resolvedModelId: 'nova-3', modelRevision: 'synthetic-release', diarizationModel: 'v2',
  requestId: 'synthetic-request', durationMs: 5000, detectedLanguage: 'ru', noSpeech: false,
}
async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 4000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Transcription state did not settle')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
function fixture(transcribeCloud: NonNullable<ConstructorParameters<typeof LocalMeetingStore>[0]['transcribeCloud']>) {
  const root = mkdtempSync(join(tmpdir(), 'deepgram-meeting-')); directories.push(root)
  const store = new LocalMeetingStore({ root, detectEngine: () => engine, emit() {}, transcribeCloud })
  return { root, store }
}
async function recording(store: LocalMeetingStore) {
  const started = store.recStart({ title: 'Synthetic diarized recording', workspaceId: 'workspace-1', mimeType: 'audio/wav', owner: 1 })
  if (!started.ok) throw new Error(started.code)
  const id = started.value.id
  const bytes = new Uint8Array(44); bytes.set([82, 73, 70, 70]); bytes.set([87, 65, 86, 69], 8)
  store.recChunk(id, bytes)
  await store.recStop(id, { durationMs: 1000 })
  return id
}

describe('Deepgram Electron meeting queue', () => {
  it('transcribes without ffmpeg/Whisper and persists speaker paragraphs and latest provenance', async () => {
    let calls = 0
    const { root, store } = fixture(async (input) => { calls++; expect(input.audio).toHaveLength(44); return transcript })
    const id = await recording(store)
    await waitUntil(() => store.read(id)?.transcript.status === 'done')
    expect(calls).toBe(1)
    expect(store.read(id)).toMatchObject({ durationMs: 5000, transcript: { engine: 'deepgram', model: 'nova-3', segments: 2, revision: 1 } })
    const saved = store.readTranscript(id)!
    expect(saved.segments.map((segment) => [segment.startMs, segment.endMs, segment.speakerId])).toEqual([[250, 1500, 'speaker-1'], [2250, 4000, 'speaker-2']])
    expect(saved.provenance).toMatchObject({ engine: 'deepgram', modelRevision: 'synthetic-release', diarizationModel: 'v2' })
    const markdown = readFileSync(join(root, id, 'transcript.md'), 'utf8')
    expect(markdown).toContain('speaker-1: Hello.\n\n')
    expect(markdown).toContain('speaker-2: Привет.')
    store.transcribe(id)
    await waitUntil(() => store.read(id)?.transcript.revision === 2)
    expect(store.readTranscriptRevision(id, 1)?.segments).toHaveLength(2)
  })

  it('cancellation aborts upload and suppresses late text, durations and files before retry', async () => {
    const first = Promise.withResolvers<NormalizedTranscript>()
    let signal: AbortSignal | undefined
    let calls = 0
    const { root, store } = fixture(async (input) => {
      calls++; if (calls === 1) { signal = input.signal; return first.promise }; return transcript
    })
    const id = await recording(store)
    await waitUntil(() => signal !== undefined)
    expect(store.cancelTranscription(id).ok).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(store.read(id)?.transcript.status).toBe('cancelled')
    first.resolve({ ...transcript, durationMs: 180000 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.read(id)?.durationMs).toBe(1000)
    expect(store.readTranscript(id)).toBeNull()
    expect(() => readFileSync(join(root, id, 'transcript.json'))).toThrow()
    expect(store.transcribe(id).ok).toBe(true)
    await waitUntil(() => store.read(id)?.transcript.status === 'done')
    expect(calls).toBe(2)
    expect(store.read(id)?.durationMs).toBe(5000)
  })

  it('refuses a linked recording before any retry audio reaches the cloud provider', async () => {
    let calls = 0
    const { root, store } = fixture(async () => { calls++; return transcript })
    const id = await recording(store)
    await waitUntil(() => store.read(id)?.transcript.status === 'done')
    const audioPath = join(root, id, store.read(id)!.audio!.file)
    const target = join(root, 'foreign-audio.wav')
    writeFileSync(target, 'foreign-sensitive-fixture')
    rmSync(audioPath); symlinkSync(target, audioPath)
    expect(store.transcribe(id).ok).toBe(true)
    await waitUntil(() => store.read(id)?.transcript.status === 'failed')
    expect(calls).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe('foreign-sensitive-fixture')
    expect(store.read(id)?.transcript.error).not.toContain(root)
  })
  it('marks provider failure for retry instead of silently saving an empty local transcript', async () => {
    const { store } = fixture(async () => { throw new Error('Deepgram transcription failed (429)') })
    const id = await recording(store)
    await waitUntil(() => store.read(id)?.transcript.status === 'failed')
    expect(store.read(id)?.transcript.error).toBe('Deepgram transcription failed (429)')
    expect(store.readTranscript(id)).toBeNull()
  })
})
