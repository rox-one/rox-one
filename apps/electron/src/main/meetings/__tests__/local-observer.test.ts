import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMeetingStore } from '../local-store'
import { LocalMeetingObserver } from '../local-observer'
import type { LocalTranscriptSegment } from '../../../shared/meetings-local'

const NO_ENGINE = { ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: ['no-whisper', 'no-model', 'no-ffmpeg'] }

function sink() {
  const persisted = new Map<string, LocalTranscriptSegment[]>()
  return {
    persisted,
    sink: {
      appendObservedSegment(meetingId: string, segment: LocalTranscriptSegment) {
        if (meetingId === 'missing') return null
        const list = persisted.get(meetingId) ?? []
        const index = list.findIndex((existing) => existing.id === segment.id)
        if (index >= 0) list[index] = segment
        else list.push(segment)
        persisted.set(meetingId, list)
        return list
      },
    },
  }
}

describe('device observe lane (d2.4)', () => {
  it('refuses to ingest before start and after stop', () => {
    const { sink: s } = sink()
    const observer = new LocalMeetingObserver(s, () => 1000)
    expect(observer.ingest('m1', { id: 'a', startMs: 0, endMs: 1, text: 'hi', source: 'microphone', observer: 'asr-stream' }))
      .toEqual({ ok: false, code: 'not-observing' })
    observer.observeStart('m1')
    expect(observer.isObserving('m1')).toBe(true)
    observer.observeStop('m1')
    expect(observer.isObserving('m1')).toBe(false)
    expect(observer.ingest('m1', { id: 'a', startMs: 0, endMs: 1, text: 'hi', source: 'microphone', observer: 'asr-stream' }))
      .toEqual({ ok: false, code: 'not-observing' })
  })

  it('maps provenance and never fabricates ownEcho on mic-only capture', () => {
    const { sink: s, persisted } = sink()
    const observer = new LocalMeetingObserver(s, () => 1000)
    observer.observeStart('m1')

    const self = observer.ingest('m1', {
      id: 'a', startMs: 0, endMs: 1000, text: 'привет', speaker: 'Иван', selfSpeaker: 'Иван',
      source: 'microphone', observer: 'asr-stream',
    })
    expect(self.ok).toBe(true)
    if (!self.ok) return
    expect(self.segment.provenance).toMatchObject({ observer: 'asr-stream', self: 'self', speaker: 'Иван' })
    expect(self.segment.ownEcho).toBeUndefined()
    expect(self.line.ownEcho).toBeUndefined()

    const echo = observer.ingest('m1', {
      id: 'b', startMs: 1000, endMs: 2000, text: 'assistant', speaker: 'Ассистент', selfSpeaker: 'Ассистент',
      source: 'system', observer: 'browser-caption',
    })
    expect(echo.ok && echo.segment.ownEcho).toBe(true)
    expect(echo.ok && echo.line.ownEcho).toBe(true)

    expect(persisted.get('m1')?.map((segment) => segment.id)).toEqual(['a', 'b'])
  })

  it('dedupes replayed keys and pages lines by seq', () => {
    const { sink: s } = sink()
    const observer = new LocalMeetingObserver(s, () => 1000)
    observer.observeStart('m1')
    observer.ingest('m1', { id: 'a', startMs: 0, endMs: 1, text: 'a', source: 'microphone', observer: 'asr-stream' })
    observer.ingest('m1', { id: 'b', startMs: 1, endMs: 2, text: 'b', source: 'microphone', observer: 'asr-stream' })
    expect(observer.ingest('m1', { id: 'b', startMs: 1, endMs: 2, text: 'b', source: 'microphone', observer: 'asr-stream' }))
      .toEqual({ ok: false, code: 'duplicate' })
    expect(observer.lines('m1').map((line) => line.seq)).toEqual([0, 1])
    expect(observer.lines('m1', 0).map((line) => line.seq)).toEqual([1])
    expect(observer.ingest('m1', { id: 'c', startMs: 2, endMs: 3, text: '   ', source: 'microphone', observer: 'asr-stream' }))
      .toEqual({ ok: false, code: 'empty-text' })
  })

  it('reports a missing meeting instead of silently dropping the line', () => {
    const { sink: s } = sink()
    const observer = new LocalMeetingObserver(s, () => 1000)
    observer.observeStart('missing')
    expect(observer.ingest('missing', { id: 'a', startMs: 0, endMs: 1, text: 'hi', source: 'microphone', observer: 'asr-stream' }))
      .toEqual({ ok: false, code: 'meeting-not-found' })
  })
})

describe('LocalMeetingStore.appendObservedSegment (fs)', () => {
  let root: string
  let store: LocalMeetingStore
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rox-observe-store-'))
    store = new LocalMeetingStore({ root, detectEngine: () => NO_ENGINE, emit: () => {} })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('persists observe lines with provenance and merges by id', () => {
    const meeting = store.create({ title: 'Observe', workspaceId: 'ws' })
    const segment: LocalTranscriptSegment = {
      id: 's1', startMs: 0, endMs: 1000, text: 'решили начать', speakerId: 'Иван', source: 'microphone',
      provenance: { observer: 'asr-stream', sessionId: 'sess', self: 'other', speaker: 'Иван' },
    }
    expect(store.appendObservedSegment(meeting.id, segment)?.length).toBe(1)
    store.appendObservedSegment(meeting.id, { ...segment, text: 'решили начать сейчас', ownEcho: true })
    const transcript = store.readTranscript(meeting.id)
    expect(transcript?.segments).toHaveLength(1)
    expect(transcript?.segments[0]?.text).toBe('решили начать сейчас')
    expect(transcript?.segments[0]?.ownEcho).toBe(true)
    expect(transcript?.segments[0]?.provenance?.observer).toBe('asr-stream')
    expect(store.read(meeting.id)?.transcript.status).toBe('done')
    expect(store.appendObservedSegment('missing', segment)).toBeNull()
  })
})