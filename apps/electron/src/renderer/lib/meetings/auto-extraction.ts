import { useEffect } from 'react'
import { planMeetingActions } from '@rox/shared/meeting-agents'
import i18n from 'i18next'
import type { LocalMeeting, MeetingsLocalApi } from '../../../shared/meetings-local'
import { meetingsApi } from './recorder'
import { extractJsonBlock, readAgentRun, startAgentRun, type AgentRunRequest, type AgentRunSnapshot } from '../extra-screens/agent-run'
import { buildSummaryPrompt, parseSummaryExtraction } from '../../pages/meetings/local-meetings-model'
import { loadDecisions, saveDecisions } from '../../pages/extra-screens/decisions/decisions-store'
import type { DecisionCandidate } from '../../pages/extra-screens/decisions/decisions-model'
import { readWorkspaceJsonSnapshot, saveWorkspaceJson } from '../extra-screens/storage'

const inflight = new Set<string>()
const START_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 10 * 60_000

export interface MeetingExtractionRuntime {
  start: (request: AgentRunRequest) => Promise<string>
  read: (sessionId: string) => Promise<AgentRunSnapshot>
  now: () => number
}
const runtime: MeetingExtractionRuntime = { start: startAgentRun, read: readAgentRun, now: Date.now }

export function extractionBusy(meeting: LocalMeeting): boolean {
  return meeting.extraction?.status === 'starting' || meeting.extraction?.status === 'running' || !!meeting.summaryRun
}

export function needsAutomaticExtraction(meeting: LocalMeeting): boolean {
  return !!meeting.workspaceId && meeting.transcript.status === 'done' && !extractionBusy(meeting)
    && meeting.summaryAutoRevision !== (meeting.transcript.revision ?? 0)
}

export async function startMeetingExtraction(api: MeetingsLocalApi, meeting: LocalMeeting, language: 'ru' | 'en', automatic = false, engine = runtime, slash?: string): Promise<void> {
  if (!meeting.workspaceId || extractionBusy(meeting)) return
  const transcript = await api.readTranscript(meeting.id)
  if (!transcript?.segments.length) return
  // Reject invalid commands before acquiring a durable claim or starting a session.
  planMeetingActions({ meetingId: meeting.id, recipeId: meeting.recipeId ?? 'standup', slash }, transcript.revision)
  const claim = await api.claimExtraction(meeting.id, { workspaceId: meeting.workspaceId, transcriptRevision: transcript.revision, automatic })
  if (!claim.ok) return
  const run = claim.value.extraction!
  let sessionId: string | undefined
  try {
    await engine.start({ workspaceId: run.workspaceId, name: i18n.t('meetings.local.summaryRunName', { title: claim.value.title }),
      enabledSourceSlugs: [],
      prompt: buildSummaryPrompt({ title: claim.value.title, participants: claim.value.participants, segments: transcript.segments, language, recipeId: claim.value.recipeId ?? 'standup', slash }),
      onCreated: async (id) => {
        sessionId = id
        const attached = await api.attachExtraction(meeting.id, { runId: run.id, sessionId: id })
        if (!attached.ok) throw new Error(attached.code)
      },
    })
  } catch (error) {
    await api.failExtraction(meeting.id, { runId: run.id, code: 'extraction-start-failed' })
    if (sessionId) await window.electronAPI.cancelProcessing(sessionId, true).catch(() => {})
    throw error
  }
}

/** Persisted snapshot, then a synchronous/idempotent projection into the shared Decisions log. */
export async function projectMeetingDecisions(meeting: LocalMeeting): Promise<void> {
  const run = meeting.extraction
  const workspaceId = meeting.workspaceId
  if (!workspaceId || run?.status !== 'done' || run.workspaceId !== workspaceId) return
  const namespace = `meeting-decision-projection:${meeting.id}`
  const project = () => {
    const projected = readWorkspaceJsonSnapshot(namespace, workspaceId, (value) => typeof value === 'string' ? value : null)
    if (!projected.available) throw new Error('decision-storage-unavailable')
    if (projected.value === run.id) return
    const current = loadDecisions(workspaceId)
    const titles = new Set([...current.decisions, ...current.candidates].filter((decision) => decision.source.kind === 'meeting' && decision.source.id === meeting.id).map((decision) => decision.title.trim().toLocaleLowerCase()))
    const candidates: DecisionCandidate[] = (meeting.extractedDecisions ?? []).flatMap((decision) => {
      const title = decision.title.trim().toLocaleLowerCase()
      if (titles.has(title)) return []
      titles.add(title)
      return [{ id: decision.id, title: decision.title, why: decision.why, who: decision.who, rejected: [], source: { kind: 'meeting', id: meeting.id, label: meeting.title, segmentId: decision.sourceSegmentIds[0], startMs: decision.sourceStartMs }, extractionId: run.id }]
    })
    if (candidates.length) saveDecisions(workspaceId, { ...current, candidates: [...candidates, ...current.candidates] })
    if (!saveWorkspaceJson(namespace, workspaceId, run.id)) throw new Error('decision-storage-unavailable')
  }
  if (navigator.locks) await navigator.locks.request(`rox-meeting-decision-projection:${workspaceId}`, project)
  else project()
}

export async function syncMeetingExtraction(api: MeetingsLocalApi, meeting: LocalMeeting, engine = runtime): Promise<'running' | 'done' | 'failed'> {
  const request = meeting.extraction
  if (!request) return 'done'
  if (request.status === 'done') { await projectMeetingDecisions(meeting); return 'done' }
  if (request.status === 'failed' || request.status === 'superseded') return 'failed'
  const elapsed = engine.now() - request.startedAt
  if (request.status === 'starting') {
    if (elapsed < START_TIMEOUT_MS) return 'running'
    await api.failExtraction(meeting.id, { runId: request.id, code: 'extraction-interrupted' })
    return 'failed'
  }
  if (!request.sessionId || elapsed >= RUN_TIMEOUT_MS) {
    await api.failExtraction(meeting.id, { runId: request.id, code: 'extraction-interrupted' })
    return 'failed'
  }
  const run = await engine.read(request.sessionId)
  if (run.processing || (!run.text && run.exists && elapsed < 60_000)) return 'running'
  const fresh = await api.get(meeting.id)
  if (!fresh || fresh.extraction?.id !== request.id || fresh.extraction.status !== 'running') return 'done'
  const transcript = await api.readTranscript(meeting.id)
  if (!transcript || transcript.revision !== request.transcriptRevision || fresh.workspaceId !== request.workspaceId) {
    await api.failExtraction(meeting.id, { runId: request.id, code: 'extraction-stale' })
    return 'failed'
  }
  const parsed = parseSummaryExtraction(extractJsonBlock(run.text), transcript.segments.map((segment) => segment.id))
  if (!parsed) {
    await api.failExtraction(meeting.id, { runId: request.id, code: run.text ? 'extraction-invalid' : 'extraction-provider-failed' })
    return 'failed'
  }
  const finished = await api.finishExtraction(meeting.id, { runId: request.id, result: parsed })
  if (!finished.ok) return finished.code === 'extraction-conflict' ? 'done' : 'failed'
  await projectMeetingDecisions(finished.value)
  return 'done'
}

export function useAutomaticMeetingExtraction(workspaceId: string | null): void {
  useEffect(() => {
    const api = meetingsApi()
    if (!api || !workspaceId) return
    let stopped = false
    const tick = async () => {
      if (stopped || inflight.has(workspaceId)) return
      inflight.add(workspaceId)
      try {
        for (const meeting of await api.list(workspaceId)) {
          if (stopped) break
          if (meeting.workspaceId !== workspaceId) continue
          // Main owns the durable claim, so StrictMode, reloads and other windows cannot duplicate work.
          try {
            if (meeting.extraction) await syncMeetingExtraction(api, meeting)
            const current = await api.get(meeting.id)
            if (!stopped && current && needsAutomaticExtraction(current)) await startMeetingExtraction(api, current, (i18n.language ?? 'ru').startsWith('ru') ? 'ru' : 'en', true)
          } catch { /* The durable state contains a retryable failure; continue other meetings. */ }
        }
      } finally { inflight.delete(workspaceId) }
    }
    const runTick = () => { void tick().catch(() => {}) }
    runTick()
    const off = api.onChanged(runTick)
    const timer = setInterval(runTick, 5_000)
    return () => { stopped = true; clearInterval(timer); off() }
  }, [workspaceId])
}
