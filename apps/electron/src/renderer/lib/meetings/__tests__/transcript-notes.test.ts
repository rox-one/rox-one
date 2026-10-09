import { expect, test } from 'bun:test'
import type { LocalMeeting, LocalTranscript } from '../../../../shared/meetings-local'
import type { TranscriptRecordInput, TranscriptRecordResult } from '../../transcripts/notes'
import { createTranscriptMirror, transcriptMirrorKey, transcriptMirrorText, type TranscriptMirrorApi } from '../transcript-notes'

const FINISHED_AT = 1_700_000_000_000
const WORKSPACE = 'ws-fixture'

function transcriptFixture(): LocalTranscript {
  return {
    engine: 'deepgram',
    model: 'nova-3',
    language: 'ru',
    createdAt: FINISHED_AT,
    elapsedMs: 12_000,
    revision: 1,
    segments: [
      { id: 's1', startMs: 0, endMs: 1_000, text: 'Привет', speakerId: 'Ada' },
      { id: 's2', startMs: 1_000, endMs: 2_000, text: 'коллеги', speakerId: 'Ada' },
      { id: 's3', startMs: 2_000, endMs: 3_000, text: 'Привет, Ада', speakerId: 'Bob' },
    ],
  }
}

function meetingFixture(patch: Partial<Pick<LocalMeeting, 'id' | 'title' | 'transcript'>> = {}): LocalMeeting {
  return {
    schema: 1,
    id: patch.id ?? 'meeting-1',
    title: patch.title ?? 'Планёрка',
    workspaceId: WORKSPACE,
    createdAt: FINISHED_AT - 60_000,
    startedAt: FINISHED_AT - 60_000,
    durationMs: 60_000,
    status: 'ready',
    source: 'microphone',
    participants: [],
    notes: '',
    audio: null,
    transcript: patch.transcript ?? {
      status: 'done',
      progress: 100,
      generation: 1,
      segments: 3,
      finishedAt: FINISHED_AT,
      revision: 1,
    },
    summary: null,
    actions: [],
    documents: [],
    updatedAt: FINISHED_AT,
  }
}

function apiFixture(transcript: LocalTranscript | null = transcriptFixture()): TranscriptMirrorApi {
  return { readTranscript: async () => transcript }
}

test('a finished transcript is mirrored once with the meeting shape', async () => {
  const calls: TranscriptRecordInput[] = []
  const claimed: string[] = []
  const mirror = createTranscriptMirror({
    record: async (input): Promise<TranscriptRecordResult> => { calls.push(input); return { ok: true, noteId: 'note-1' } },
    notifyFailure: () => { throw new Error('success must stay silent') },
    onSeen: (key) => claimed.push(key),
  })

  const meeting = meetingFixture()
  // Non-finished observations never file a note.
  const running = meetingFixture({ transcript: { status: 'running', progress: 40, generation: 1, segments: 0 } })
  expect(await mirror.consider(apiFixture(), running, WORKSPACE)).toBe(false)
  expect(calls).toHaveLength(0)

  expect(await mirror.consider(apiFixture(), meeting, WORKSPACE)).toBe(true)
  expect(claimed).toEqual(['meeting-1:1'])
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({
    workspaceId: WORKSPACE,
    source: 'meeting',
    text: 'Привет коллеги\nПривет, Ада',
    at: FINISHED_AT,
    language: 'ru',
    model: 'nova-3',
    durationMs: 60_000,
    meetingId: 'meeting-1',
    meetingTitle: 'Планёрка',
    segments: [
      { speaker: 'Ada', text: 'Привет', startMs: 0 },
      { speaker: 'Ada', text: 'коллеги', startMs: 1_000 },
      { speaker: 'Bob', text: 'Привет, Ада', startMs: 2_000 },
    ],
  })
})

test('the same finished generation is never mirrored twice', async () => {
  let calls = 0
  const mirror = createTranscriptMirror({
    record: async () => { calls += 1; return { ok: true } },
    notifyFailure: () => {},
  })
  const meeting = meetingFixture()
  expect(await mirror.consider(apiFixture(), meeting, WORKSPACE)).toBe(true)
  // Re-render/remount or a repeat tick observes the identical record again.
  expect(await mirror.consider(apiFixture(), meetingFixture(), WORKSPACE)).toBe(false)
  expect(calls).toBe(1)
})

test('a new generation files a new note', async () => {
  const calls: Array<{ meetingId: string | null | undefined; at: number | undefined }> = []
  const mirror = createTranscriptMirror({
    record: async (input) => { calls.push({ meetingId: input.meetingId, at: input.at }); return { ok: true } },
    notifyFailure: () => {},
  })
  const first = meetingFixture()
  const regenerated = meetingFixture({
    transcript: { status: 'done', progress: 100, generation: 2, segments: 3, finishedAt: FINISHED_AT + 5_000, revision: 2 },
  })
  expect(await mirror.consider(apiFixture(), first, WORKSPACE)).toBe(true)
  expect(await mirror.consider(apiFixture(), regenerated, WORKSPACE)).toBe(true)
  expect(calls).toEqual([
    { meetingId: 'meeting-1', at: FINISHED_AT },
    { meetingId: 'meeting-1', at: FINISHED_AT + 5_000 },
  ])
})

test('empty segments, absent workspace and failed writes never duplicate or throw', async () => {
  const failures: string[] = []
  let calls = 0
  const mirror = createTranscriptMirror({
    record: async () => { calls += 1; return { ok: false, error: 'no vault' } },
    notifyFailure: (title) => failures.push(title),
  })
  // No workspace id → nothing to file against.
  expect(await mirror.consider(apiFixture(), meetingFixture(), null)).toBe(false)
  // Finished, but the recording produced no segments.
  expect(await mirror.consider(apiFixture(), meetingFixture({ transcript: { status: 'done', progress: 100, generation: 1, segments: 0, finishedAt: FINISHED_AT, revision: 1 } }), WORKSPACE)).toBe(false)
  // A missing transcript file files nothing and stays silent.
  expect(await mirror.consider(apiFixture(null), meetingFixture(), WORKSPACE)).toBe(false)
  expect(calls).toBe(0)
  expect(failures).toEqual([])
  // A transient vault failure is reported and the pre-write claim released, so the
  // next observation of the same key retries; once the store recovers the note lands
  // and the claim sticks.
  let failWrite = true
  const claimed: string[] = []
  const forgotten: string[] = []
  const failing = createTranscriptMirror({
    record: async () => { calls += 1; return failWrite ? { ok: false, error: 'no vault' } : { ok: true } },
    notifyFailure: (title) => failures.push(title),
    onSeen: (key) => claimed.push(key),
    onForget: (key) => forgotten.push(key),
  })
  expect(await failing.consider(apiFixture(), meetingFixture(), WORKSPACE)).toBe(false)
  expect(calls).toBe(1)
  expect(failures).toEqual(['Планёрка'])
  // The claim is recorded before the write, so a crash mid-write cannot duplicate…
  expect(claimed).toEqual(['meeting-1:1'])
  // …and released on failure, so the same finished generation is retried.
  expect(forgotten).toEqual(['meeting-1:1'])
  failWrite = false
  expect(await failing.consider(apiFixture(), meetingFixture(), WORKSPACE)).toBe(true)
  expect(calls).toBe(2)
  expect(failures).toEqual(['Планёрка'])
  // The successful claim sticks: no third attempt for the same key.
  expect(await failing.consider(apiFixture(), meetingFixture(), WORKSPACE)).toBe(false)
  expect(calls).toBe(2)
  // Claimed twice on purpose: the key is claimed per attempt, not per meeting generation
  // — issue before the write, release when the write fails, issue again on the retry.
  // The third observation above added no claim, so a successful claim is never released.
  expect(claimed).toEqual(['meeting-1:1', 'meeting-1:1'])
  expect(forgotten).toEqual(['meeting-1:1'])
})

test('helpers: key and paragraph projection', () => {
  expect(transcriptMirrorKey(meetingFixture())).toBe('meeting-1:1')
  expect(transcriptMirrorKey(meetingFixture({ transcript: { status: 'running', progress: 0, generation: 1 } }))).toBeNull()
  expect(transcriptMirrorText([
    { id: 'a', startMs: 0, endMs: 1, text: ' one ', speakerId: 'Ada' },
    { id: 'b', startMs: 1, endMs: 2, text: 'two', speakerId: 'Ada' },
    { id: 'c', startMs: 2, endMs: 3, text: 'three', speakerId: null },
  ])).toBe('one two\nthree')
})