import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalMeetingStore } from '../local-store'
import { EXTRACTION_START_TIMEOUT_MS } from '../local-extraction'
import { needsAutomaticExtraction, startMeetingExtraction, syncMeetingExtraction, type MeetingExtractionRuntime } from '../../../renderer/lib/meetings/auto-extraction'
import { loadDecisions, saveDecisions } from '../../../renderer/pages/extra-screens/decisions/decisions-store'
import type { LocalMeeting, LocalTranscript, MeetingsLocalApi } from '../../../shared/meetings-local'

const ENGINE = { ready: false, engine: null, binary: null, model: null, modelPath: null, ffmpeg: null, missing: [] }
const TRANSCRIPT: LocalTranscript = { engine: 'deepgram', model: 'nova-3', language: 'en', createdAt: 1, elapsedMs: 5, revision: 1,
  segments: [{ id: 's0', startMs: 0, endMs: 1000, text: 'We decided to ship Friday.', speakerId: 'speaker-1' }, { id: 's1', startMs: 1000, endMs: 2000, text: 'Ada will prepare the release notes.', speakerId: 'speaker-2' }] }
const RESULT = { summary: 'Ship Friday; Ada prepares release notes.', summarySourceSegmentIds: ['s0', 's1'],
  actions: [{ text: 'Ada: prepare release notes', sourceSegmentIds: ['s1'] }], decisions: [{ title: 'Ship Friday', why: 'Agreed release date', who: ['Ada'], sourceSegmentIds: ['s0'] }], questions: [] }

describe('durable automatic meeting analysis and editable results', () => {
  let root: string
  let now: number
  let store: LocalMeetingStore
  let meeting: LocalMeeting
  let api: MeetingsLocalApi
  let model: MeetingExtractionRuntime
  let output: string | null
  let starts: number
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'meeting-analysis-')); now = 1000; starts = 0; output = JSON.stringify(RESULT)
    const values = new Map<string, string>()
    const target = new EventTarget()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: target.dispatchEvent.bind(target), electronAPI: { cancelProcessing: async () => {} } } })
    store = new LocalMeetingStore({ root, detectEngine: () => ENGINE, emit() {}, now: () => now })
    meeting = store.create({ title: 'Synthetic release meeting', workspaceId: 'workspace-1' })
    writeFileSync(join(root, meeting.id, 'transcript.json'), JSON.stringify(TRANSCRIPT))
    writeFileSync(join(root, meeting.id, 'audio.wav'), new Uint8Array(44))
    writeFileSync(join(root, meeting.id, 'meeting.json'), JSON.stringify({ ...meeting, source: 'import', durationMs: 2000, audio: { file: 'audio.wav', mimeType: 'audio/wav', bytes: 44 }, transcript: { status: 'done', progress: 100, revision: 1, segments: 2 } }))
    meeting = store.read(meeting.id)!
    api = {
      get: async (id) => store.read(id), readTranscript: async (id) => store.readTranscript(id),
      claimExtraction: async (id, input) => store.claimExtraction(id, input), attachExtraction: async (id, input) => store.attachExtraction(id, input),
      finishExtraction: async (id, input) => store.finishExtraction(id, input), failExtraction: async (id, input) => store.failExtraction(id, input),
    } as MeetingsLocalApi
    model = { now: () => now, start: async (request) => { starts++; expect(request.workspaceId).toBe('workspace-1'); expect(request.prompt).toContain('segmentId=s0'); await request.onCreated?.(`session-${starts}`); return `session-${starts}` },
      read: async () => ({ exists: true, processing: false, text: output, updatedAt: now }) }
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }); if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window') })
  const current = () => store.read(meeting.id)!
  const start = () => startMeetingExtraction(api, current(), 'en', true, model)
  const finish = () => syncMeetingExtraction(api, current(), model)

  it('two windows claim a completed imported transcript only once before the model prompt', async () => {
    await Promise.all([start(), start()])
    expect(starts).toBe(1)
    expect(current().extraction).toMatchObject({ status: 'running', automatic: true, sessionId: 'session-1', transcriptRevision: 1 })
    expect(current().summaryAutoRevision).toBe(1)
    expect(needsAutomaticExtraction(current())).toBe(false)
  })
  it('persists generated summary/actions/decisions with exact citations, then preserves manual edits on reload', async () => {
    await start(); expect(await finish()).toBe('done')
    expect(current().summary).toMatchObject({ text: RESULT.summary, generated: true, sourceTranscriptRevision: 1, sourceSegmentIds: ['s0', 's1'] })
    const action = current().actions[0]!
    expect(action).toMatchObject({ generated: true, sourceSegmentIds: ['s1'], sourceTranscriptRevision: 1 })
    expect(loadDecisions('workspace-1').candidates[0]).toMatchObject({ title: 'Ship Friday', source: { kind: 'meeting', id: meeting.id, segmentId: 's0' } })
    store.saveAction(meeting.id, { actionId: action.id, patch: { text: 'Ada: review notes Monday', done: true } })
    store.update(meeting.id, { summary: { text: 'My corrected summary', generated: false, updatedAt: now } })
    const decisions = loadDecisions('workspace-1'); decisions.candidates[0]!.title = 'Ship Monday'; saveDecisions('workspace-1', decisions)
    store = new LocalMeetingStore({ root, detectEngine: () => ENGINE, emit() {}, now: () => now })
    await finish()
    expect(current().actions[0]).toMatchObject({ text: 'Ada: review notes Monday', done: true, generated: true, sourceSegmentIds: ['s1'] })
    expect(current().summary?.text).toBe('My corrected summary')
    expect(loadDecisions('workspace-1').candidates.map((candidate) => candidate.title)).toEqual(['Ship Monday'])
    expect(JSON.parse(readFileSync(join(root, meeting.id, 'meeting.json'), 'utf8')).extraction.status).toBe('done')
  })
  it('a manual edit during a model run supersedes late results without replacing it or adding stale decisions', async () => {
    await start(); store.update(meeting.id, { summary: { text: 'Human notes', generated: false, updatedAt: now } })
    expect(await finish()).toBe('failed')
    expect(current().extraction?.status).toBe('superseded')
    expect(current().summary?.text).toBe('Human notes'); expect(current().actions).toHaveLength(0); expect(loadDecisions('workspace-1').candidates).toHaveLength(0)
  })
  it('new transcript revisions reject an old response and schedule their own single automatic analysis', async () => {
    await start()
    expect((await store.updateTranscriptSegment(meeting.id, { expectedRevision: 1, segmentId: 's0', patch: { speakerId: 'Ada' } })).ok).toBe(true)
    expect(await finish()).toBe('failed'); expect(current().extraction?.status).toBe('superseded'); expect(current().actions).toHaveLength(0)
    expect(needsAutomaticExtraction(current())).toBe(true)
    await start(); expect(starts).toBe(2); expect(current().extraction?.transcriptRevision).toBe(2)
    expect(await finish()).toBe('done'); expect(current().actions[0]?.sourceTranscriptRevision).toBe(2)
  })
  it('retains failed provider state and retries only from an explicit user action', async () => {
    model.start = async () => { starts++; throw new Error('Synthetic provider unavailable') }
    await expect(start()).rejects.toThrow('Synthetic provider unavailable')
    expect(current().extraction).toMatchObject({ status: 'failed', errorCode: 'extraction-start-failed' }); expect(needsAutomaticExtraction(current())).toBe(false)
    model.start = async (request) => { starts++; await request.onCreated?.('retry-session'); return 'retry-session' }
    await startMeetingExtraction(api, current(), 'en', false, model)
    expect(await finish()).toBe('done'); expect(current().summary?.sessionId).toBe('retry-session')
  })
  it('invalid output yields a persistent visible failure and never fabricates tasks or decisions', async () => {
    await start(); output = 'No valid structured result'; expect(await finish()).toBe('failed')
    expect(current().extraction?.errorCode).toBe('extraction-invalid'); expect(current().actions).toHaveLength(0); expect(current().summary).toBeNull()
  })
  it('missing model output fails after the startup grace period and stays retryable', async () => {
    await start(); output = null; expect(await finish()).toBe('running'); now += 60_001
    expect(await finish()).toBe('failed'); expect(current().extraction?.errorCode).toBe('extraction-provider-failed'); expect(needsAutomaticExtraction(current())).toBe(false)
  })
  it('interruption before session attachment survives restart and becomes an explicit retry state', async () => {
    store.claimExtraction(meeting.id, { workspaceId: 'workspace-1', transcriptRevision: 1, automatic: true })
    store = new LocalMeetingStore({ root, detectEngine: () => ENGINE, emit() {}, now: () => now })
    now += EXTRACTION_START_TIMEOUT_MS + 1
    expect(await finish()).toBe('failed'); expect(current().extraction?.errorCode).toBe('extraction-interrupted'); expect(starts).toBe(0)
  })
  it('a valid explicitly empty extraction completes without made-up decisions', async () => {
    await start(); output = JSON.stringify({ summary: '', summarySourceSegmentIds: [], actions: [], decisions: [], questions: [] })
    expect(await finish()).toBe('done'); expect(current().actions).toHaveLength(0); expect(current().summary).toBeNull(); expect(current().extractedDecisions).toHaveLength(0)
  })
  it('single-action edits, completion and deletion merge into the fresh durable meeting', async () => {
    await start(); await finish(); const first = current().actions[0]!
    store.saveAction(meeting.id, { actionId: 'manual-action', create: true, patch: { text: 'Second independent task' } })
    store.saveAction(meeting.id, { actionId: first.id, patch: { text: 'Edited first', done: true } })
    expect(current().actions.map((action) => action.text)).toEqual(['Edited first', 'Second independent task'])
    store.saveAction(meeting.id, { actionId: first.id, remove: true }); expect(current().actions.map((action) => action.id)).toEqual(['manual-action'])
  })
  it('an old completion cannot win over a newer retry run', async () => {
    await start(); const old = current().extraction!
    store.failExtraction(meeting.id, { runId: old.id, code: 'extraction-provider-failed' })
    await startMeetingExtraction(api, current(), 'en', false, model)
    expect(store.finishExtraction(meeting.id, { runId: old.id, result: RESULT })).toEqual({ ok: false, code: 'extraction-conflict' })
    expect(current().extraction?.id).not.toBe(old.id); expect(current().actions).toHaveLength(0)
  })
  it('dismissed generated candidates stay dismissed when a completed meeting is revisited', async () => {
    await start(); await finish(); const data = loadDecisions('workspace-1'); saveDecisions('workspace-1', { ...data, candidates: [] })
    await finish(); await finish(); expect(loadDecisions('workspace-1').candidates).toHaveLength(0)
  })
  it('automatic tasks/decisions still appear when an existing manual summary should be kept', async () => {
    store.update(meeting.id, { summary: { text: 'Human summary before transcription', generated: false, updatedAt: now } })
    await start(); await finish(); expect(current().summary?.text).toBe('Human summary before transcription'); expect(current().actions).toHaveLength(1); expect(current().extractedDecisions).toHaveLength(1)
  })
  it('rejects foreign workspace claims and completion after a workspace binding changes', async () => {
    expect(store.claimExtraction(meeting.id, { workspaceId: 'workspace-2', transcriptRevision: 1, automatic: true })).toEqual({ ok: false, code: 'extraction-stale' })
    await start(); const snapshot = current(); writeFileSync(join(root, meeting.id, 'meeting.json'), JSON.stringify({ ...snapshot, workspaceId: 'workspace-2' }))
    expect(await finish()).toBe('failed'); expect(current().actions).toHaveLength(0); expect(loadDecisions('workspace-1').candidates).toHaveLength(0)
  })
  it('validates provenance at the main-process boundary even if renderer output includes fabricated IDs', async () => {
    await start(); const run = current().extraction!
    const result = store.finishExtraction(meeting.id, { runId: run.id, result: { ...RESULT, actions: [{ text: 'Forged action', sourceSegmentIds: ['missing'] }] } })
    expect(result.ok).toBe(true); expect(current().actions).toHaveLength(0); expect(current().extractedDecisions).toHaveLength(1)
  })
})
