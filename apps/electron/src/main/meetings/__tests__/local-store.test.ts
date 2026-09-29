import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMeetingStore } from '../local-store'
import {
  applyPatch,
  emptyLocalMeeting,
  isMeetingId,
  newMeetingId,
  normalizeMeeting,
  parseWhisperJson,
  parseWhisperProgress,
  pickWhisperModel,
  transcriptMarkdown,
  uniqueName,
} from '../local-model'

const NO_ENGINE = { ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: ['no-whisper', 'no-model', 'no-ffmpeg'] }

describe('local meeting model', () => {
  it('generates safe ids and rejects traversal', () => {
    const id = newMeetingId(new Date(2026, 8, 29, 17, 5, 9).getTime(), () => 0.5)
    expect(id.startsWith('m-20260929-170509-')).toBe(true)
    expect(isMeetingId(id)).toBe(true)
    expect(isMeetingId('../etc')).toBe(false)
    expect(isMeetingId('m-../../x')).toBe(false)
  })

  it('normalizes a corrupt meeting.json without throwing', () => {
    const m = normalizeMeeting({ title: '  ', status: 'weird', audio: { file: '../x.webm' }, documents: [{ file: '../../a' }, { file: 'ok.pdf', name: 'ok.pdf' }] }, 'm-1234')
    expect(m?.title).toBe('m-1234')
    expect(m?.status).toBe('ready')
    expect(m?.audio).toBeNull()
    expect(m?.documents.map((d) => d.file)).toEqual(['ok.pdf'])
    expect(normalizeMeeting(null, 'm-1234')).toBeNull()
  })

  it('patches only user-editable fields', () => {
    const base = emptyLocalMeeting({ id: 'm-abcd', title: 'A', workspaceId: 'w', now: 1 })
    const next = applyPatch(base, { title: ' B ', participants: [' Ann ', ''], notes: 'n', actions: [{ id: 'a', text: 'do', done: false, createdAt: 1 }], ...( { status: 'recording' } as object) }, 2)
    expect(next.title).toBe('B')
    expect(next.participants).toEqual(['Ann'])
    expect(next.status).toBe('ready')
    expect(next.actions).toHaveLength(1)
  })

  it('parses whisper.cpp JSON output', () => {
    const parsed = parseWhisperJson({
      result: { language: 'ru' },
      transcription: [
        { timestamps: { from: '00:00:00,000', to: '00:00:02,500' }, offsets: { from: 0, to: 2500 }, text: ' Проверка записи встречи.' },
        { timestamps: { from: '00:00:02,500', to: '00:00:04,000' }, text: ' [BLANK_AUDIO]' },
        { timestamps: { from: '00:01:02,040', to: '00:01:03,000' }, text: ' Hello' },
      ],
    })
    expect(parsed.language).toBe('ru')
    expect(parsed.segments.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [0, 2500, 'Проверка записи встречи.'],
      [62040, 63000, 'Hello'],
    ])
  })

  it('reads whisper progress and picks the best model', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  15%\n... progress =  40%')).toBe(40)
    expect(parseWhisperProgress('nothing')).toBeNull()
    expect(pickWhisperModel(['ggml-small.bin', 'ggml-large-v3-turbo-q5_0.bin', 'ggml-silero-v5.1.2.bin'])).toBe('ggml-large-v3-turbo-q5_0.bin')
    expect(pickWhisperModel(['ggml-large-v3-turbo.bin.part'])).toBeNull()
  })

  it('makes unique document names and readable markdown', () => {
    expect(uniqueName('a.pdf', new Set(['a.pdf', 'a (2).pdf']))).toBe('a (3).pdf')
    expect(uniqueName('../x', new Set())).toBe('__x')
    const md = transcriptMarkdown({ title: 'T', createdAt: 0, durationMs: 61000 }, { engine: 'whisper.cpp', model: 'small', language: 'ru', createdAt: 0, elapsedMs: 1, segments: [{ id: 's0', startMs: 65000, endMs: 66000, text: 'Привет' }] })
    expect(md).toContain('[01:05] Привет')
    expect(md).toContain('duration: 01:01')
  })
})

describe('LocalMeetingStore (fs)', () => {
  let root: string
  let store: LocalMeetingStore
  const emitted: string[] = []
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rox-meetings-'))
    emitted.length = 0
    store = new LocalMeetingStore({ root, detectEngine: () => NO_ENGINE, emit: (id) => emitted.push(id) })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('records chunks to disk and finalizes without ffmpeg (transcript marked unavailable)', async () => {
    const started = store.recStart({ title: 'Стендап', workspaceId: 'w1', mimeType: 'audio/webm;codecs=opus', owner: 7 })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const id = started.value.id
    expect(store.recStart({ title: 'x', workspaceId: 'w1', mimeType: 'audio/webm', owner: 7 })).toEqual({ ok: false, code: 'already-recording' })
    expect(store.recChunk(id, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(store.recChunk(id, new Uint8Array([4]))).toBe(true)
    store.recState(id, { paused: true, durationMs: 4200 })
    expect(store.read(id)?.status).toBe('paused')
    const stopped = await store.recStop(id, { durationMs: 5000 })
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(stopped.value.status).toBe('ready')
    expect(stopped.value.audio?.file).toBe('audio.webm')
    expect(stopped.value.durationMs).toBe(5000)
    expect(stopped.value.transcript.status).toBe('unavailable')
    expect([...readFileSync(join(root, id, 'audio.webm'))]).toEqual([1, 2, 3, 4])
    expect(existsSync(join(root, id, 'audio.part.webm'))).toBe(false)
    expect(emitted).toContain(id)
  })

  it('recovers a recording interrupted by a crash', async () => {
    const started = store.recStart({ title: 'Crash', workspaceId: null, mimeType: 'audio/webm', owner: 1 })
    if (!started.ok) throw new Error('start failed')
    store.recChunk(started.value.id, new Uint8Array([9, 9]))
    store.recState(started.value.id, { paused: false, durationMs: 3000 })
    // New process: a fresh store sees status=recording + a part file.
    const after = new LocalMeetingStore({ root, detectEngine: () => NO_ENGINE, emit: () => {} })
    const ids = await after.recover(() => false)
    expect(ids).toEqual([started.value.id])
    const m = after.read(started.value.id)!
    expect(m.status).toBe('ready')
    expect(m.audio?.recovered).toBe(true)
    expect(m.durationMs).toBe(3000)
  })

  it('imports audio, rejects unsupported files, attaches and removes documents, lists per workspace', async () => {
    const src = join(root, 'in.m4a')
    writeFileSync(src, new Uint8Array([1, 2, 3]))
    const bad = join(root, 'in.txt')
    writeFileSync(bad, 'x')
    expect(await store.importAudio({ path: bad, workspaceId: 'w1' })).toEqual({ ok: false, code: 'unsupported-format' })
    const imported = await store.importAudio({ path: src, workspaceId: 'w1' })
    if (!imported.ok) throw new Error(imported.code)
    expect(imported.value.title).toBe('in')
    expect(imported.value.source).toBe('import')
    expect(imported.value.audio?.mimeType).toBe('audio/mp4')
    expect(await store.importAudio({ path: src, meetingId: imported.value.id, workspaceId: 'w1' })).toEqual({ ok: false, code: 'meeting-has-audio' })

    const doc = join(root, 'agenda.pdf')
    writeFileSync(doc, 'pdf')
    const withDocs = store.attach(imported.value.id, [doc, doc])!
    expect(withDocs.documents.map((d) => d.file)).toEqual(['agenda.pdf', 'agenda (2).pdf'])
    expect(existsSync(join(root, imported.value.id, 'documents', 'agenda (2).pdf'))).toBe(true)
    const removed = store.removeDocument(imported.value.id, withDocs.documents[0]!.id)!
    expect(removed.documents).toHaveLength(1)

    store.create({ title: 'other ws', workspaceId: 'w2' })
    expect(store.list('w1').map((m) => m.title)).toEqual(['in'])
    expect(store.list(null)).toHaveLength(2)
  })

  it('planned meetings keep their schedule; record into a planned meeting', async () => {
    const planned = store.create({ title: 'Ретро', workspaceId: 'w', scheduledAt: Date.now() + 3600_000 })
    expect(planned.status).toBe('planned')
    const started = store.recStart({ meetingId: planned.id, title: 'ignored', workspaceId: 'w', mimeType: 'audio/webm', owner: 1 })
    expect(started.ok && started.value.id).toBe(planned.id)
    expect(started.ok && started.value.title).toBe('Ретро')
  })
})
