import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LocalMeetingDetail, type DetailTab } from '../../../LocalMeetingDetail'
import { useAutomaticMeetingExtraction, syncMeetingExtraction } from '@/lib/meetings/auto-extraction'
import { emptyLocalMeeting, applyPatch } from '../../../../../../main/meetings/local-model'
import { applyExtractionResult } from '../../../../../../main/meetings/local-extraction'
import type { LocalMeeting, LocalTranscript, MeetingsLocalApi } from '../../../../../../shared/meetings-local'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'

// Synthetic transport/persistence, production component, prompt, worker and parsers.
// No actual account, cloud audio, AI request or personal meeting data is touched.
const params = new URLSearchParams(location.search)
let outcome = params.get('outcome') ?? 'ok'
const listeners = new Set<() => void>()
const calls: Array<{ method: string; value?: unknown }> = []
const key = 'synthetic-meeting-extraction'
const transcript: LocalTranscript = { engine: 'deepgram', model: 'nova-3', language: 'en', createdAt: Date.now(), elapsedMs: 1, revision: 1,
  segments: [{ id: 's0', startMs: 0, endMs: 1000, speakerId: 'speaker-1', text: 'We decided to ship Friday.' }, { id: 's1', startMs: 1000, endMs: 2000, speakerId: 'speaker-2', text: 'Ada will prepare the release notes.' }] }
const generated = { summary: 'Ship Friday, with release notes prepared by Ada.', summarySourceSegmentIds: ['s0', 's1'], actions: [{ text: 'Ada: prepare release notes', sourceSegmentIds: ['s1'] }], decisions: [{ title: 'Ship Friday', why: 'The release date was agreed', who: ['Ada'], sourceSegmentIds: ['s0'] }], questions: [] }
let meeting: LocalMeeting = JSON.parse(localStorage.getItem(key) ?? 'null') ?? { ...emptyLocalMeeting({ id: 'm-browser-extraction', title: 'Release planning', workspaceId: 'workspace-1', now: Date.now() }), source: 'import', status: 'ready', transcript: { status: 'done', progress: 100, revision: 1, segments: 2, model: 'nova-3', engine: 'deepgram' } }
const sessions = new Map<string, { isProcessing: boolean; messages: Array<{ role: string; content: string }> }>()
const write = (next: LocalMeeting) => { meeting = next; localStorage.setItem(key, JSON.stringify(next)); listeners.forEach((listener) => listener()); return next }
const failure = (code: string) => ({ ok: false as const, code })
const implementedApi = {
  list: async () => [meeting], get: async () => meeting, readTranscript: async () => transcript,
  recover: async () => [],
  update: async (_id, patch) => write(applyPatch(meeting, patch, Date.now())), onChanged: (listener) => { const notify = () => listener({ id: meeting.id }); listeners.add(notify); return () => { listeners.delete(notify) } },
  claimExtraction: async (_id, input) => {
    calls.push({ method: 'claim', value: input })
    if (meeting.extraction?.status === 'running' || meeting.extraction?.status === 'starting') return failure('extraction-busy')
    if (input.automatic && meeting.summaryAutoRevision === input.transcriptRevision) return failure('extraction-already-attempted')
    return { ok: true, value: write({ ...meeting, summaryAutoRevision: transcript.revision, extraction: { id: crypto.randomUUID(), workspaceId: 'workspace-1', transcriptRevision: transcript.revision, editRevision: meeting.analysisEditRevision ?? 0, automatic: input.automatic, status: 'starting', startedAt: Date.now() } }) }
  },
  attachExtraction: async (_id, input) => {
    if (meeting.extraction?.id !== input.runId || meeting.extraction.status !== 'starting') return failure('extraction-conflict')
    return { ok: true, value: write({ ...meeting, extraction: { ...meeting.extraction, status: 'running', sessionId: input.sessionId } }) }
  },
  finishExtraction: async (_id, input) => { const result = applyExtractionResult(meeting, transcript, input.runId, input.result, Date.now()); if (result.ok) write(result.value); return result },
  failExtraction: async (_id, input) => {
    if (meeting.extraction?.id !== input.runId || !['starting', 'running'].includes(meeting.extraction.status)) return failure('extraction-conflict')
    return { ok: true, value: write({ ...meeting, extraction: { ...meeting.extraction, status: input.code === 'extraction-stale' ? 'superseded' : 'failed', errorCode: input.code, finishedAt: Date.now() } }) }
  },
  saveAction: async (_id, input) => {
    calls.push({ method: 'saveAction', value: input })
    const actions = input.remove ? meeting.actions.filter((action) => action.id !== input.actionId) : input.create ? [...meeting.actions, { id: input.actionId, text: input.patch?.text ?? '', done: false, createdAt: Date.now() }] : meeting.actions.map((action) => action.id === input.actionId ? { ...action, ...input.patch, editedAt: Date.now() } : action)
    return { ok: true, value: write(applyPatch(meeting, { actions }, Date.now())) }
  },
} satisfies Partial<MeetingsLocalApi>
// This fixture implements the API used by extraction; other device operations
// are intentionally absent and never invoked by these acceptance scenarios.
const api = implementedApi as unknown as MeetingsLocalApi
window.electronAPI = {
  meetingsLocal: api,
  createSession: async (workspaceId: string, options: unknown) => { calls.push({ method: 'createSession', value: { workspaceId, options } }); const id = `synthetic-session-${calls.filter((call) => call.method === 'createSession').length}`; sessions.set(id, { isProcessing: true, messages: [] }); return { id } },
  sendMessage: async (id: string, prompt: string) => { calls.push({ method: 'sendMessage', value: prompt }); if (outcome !== 'deferred') sessions.set(id, { isProcessing: false, messages: [{ role: 'assistant', content: outcome === 'invalid' ? 'Synthetic malformed output' : JSON.stringify(generated) }] }); await syncMeetingExtraction(api, meeting) },
  getSessionMessages: async (id: string) => sessions.get(id) ?? null,
  cancelProcessing: async () => {},
} as unknown as typeof window.electronAPI
;(window as unknown as { __meetingFixture: unknown }).__meetingFixture = { calls, read: () => meeting, finish: async () => { outcome = 'ok'; if (meeting.extraction?.sessionId) sessions.set(meeting.extraction.sessionId, { isProcessing: false, messages: [{ role: 'assistant', content: JSON.stringify(generated) }] }); await syncMeetingExtraction(api, meeting) }, allowRetry: () => { outcome = 'ok' } }
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
function App() {
  const [data, setData] = useState(meeting)
  const [tab, setTab] = useState<DetailTab>('overview')
  const [banner, setBanner] = useState<string | null>(null)
  useEffect(() => { const listener = () => setData(meeting); listeners.add(listener); return () => { listeners.delete(listener) } }, [])
  useAutomaticMeetingExtraction('workspace-1')
  return <main className="mx-auto flex min-h-screen max-w-4xl flex-col bg-background text-foreground"><LocalMeetingDetail meeting={data} workspaceId="workspace-1" engine={{ ready: true, engine: 'deepgram', binary: null, model: 'nova-3', modelPath: null, ffmpeg: null, missing: [] }} tab={tab} onTab={setTab} onChanged={setData} onBanner={setBanner} onTrashed={() => {}} /><output data-testid="fixture-banner">{banner}</output></main>
}
createRoot(document.getElementById('root')!).render(<App />)
