/**
 * Observe-only capture intent + live coordinator (S6). Grant-gated intents write
 * `session.upsert` through the same journal CAS path as capture/finalize. The
 * live coordinator keeps bounded, device-scoped transcript lines in memory and
 * persists only session records and rolling summaries — per-line text is never
 * journaled, so the workspace journal cannot grow without bound.
 */
import { authorizeMeetingAction, type MeetingGrant } from '@rox/shared/meeting-agents'
import type { MeetingSessionRecord, MeetingSessionSummary, MeetingSessionTransport } from '@rox/core/meetings'
import { emptyMeetingSession, isActiveSessionState } from '@rox/core/meetings'
import { MeetingJournal } from './journal.ts'
import { MeetingSessionRuntime } from './session-runtime.ts'
import { MeetingTranscriptStore, type AppendInput, type ObserveTranscriptLine, type TranscriptEviction } from './session-transcript-store.ts'
import { runSummaryCadence, type SummaryModelStep } from './summary-cadence.ts'

export const OBSERVE_TRANSPORT_DEFAULT: MeetingSessionTransport = 'mic'

export type ObserveNativeResult =
  | { ok: true; session: MeetingSessionRecord; observing: boolean }
  | { ok: false; code: string }

function readLatestObserveSession(rootDir: string, meetingId: string): MeetingSessionRecord | null {
  try {
    const snapshot = new MeetingJournal(rootDir, { readOnly: true }).read(meetingId)
    const sessions = Object.values(snapshot.sessions)
    return sessions.length ? sessions[sessions.length - 1]! : null
  } catch {
    return null
  }
}

/** Grant-gated observe intent mirroring capture.ts. */
export function applyNativeObserveIntent(input: {
  persistRootDir: string
  workspaceId: string
  actorId: string
  grant: MeetingGrant | null
  meetingId: string
  action: 'start' | 'pause' | 'stop'
  sessionId?: string
  transport?: MeetingSessionTransport
  now?: number
}): ObserveNativeResult {
  if (!input.grant) return { ok: false, code: 'grant-required' }
  if (!input.persistRootDir) return { ok: false, code: 'config-dir-required' }
  if (!input.workspaceId) return { ok: false, code: 'workspace-required' }
  if (!input.meetingId) return { ok: false, code: 'meeting-required' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.grant.deviceId,
    capability: 'mic',
    operation: 'observe',
    targetId: input.meetingId,
  })
  if (!auth.ok) return { ok: false, code: auth.code }
  const now = input.now ?? 0
  const journal = new MeetingJournal(input.persistRootDir)
  try {
    let snapshot
    try {
      snapshot = journal.read(input.meetingId)
    } catch {
      return { ok: false, code: 'meeting-not-found' }
    }
    if (snapshot.meeting.workspaceId !== input.workspaceId) return { ok: false, code: 'workspace-mismatch' }
    const current = readLatestObserveSession(input.persistRootDir, input.meetingId)
    const sessionId = input.sessionId ?? current?.sessionId ?? `observe-${input.meetingId}`
    const state = input.action === 'start' ? 'in_call' : input.action === 'pause' ? 'paused' : 'ended'
    const base = current?.sessionId === sessionId
      ? current
      : emptyMeetingSession({
          sessionId,
          workspaceId: input.workspaceId,
          meetingId: input.meetingId,
          transport: input.transport ?? OBSERVE_TRANSPORT_DEFAULT,
          mode: 'observe',
          now,
        })
    const session: MeetingSessionRecord = {
      ...base,
      state,
      updatedAt: now,
      ...(base.joinedAt == null ? { joinedAt: now } : {}),
      ...(state === 'ended' ? { endedAt: now } : {}),
    }
    journal.commit({
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      expectedRevision: snapshot.meeting.revision,
      commandId: `observe-${input.action}-${sessionId}-${snapshot.meeting.revision}`,
      events: [{ type: 'session.upsert', session }],
      outboxEntries: [],
    })
    return { ok: true, session, observing: isActiveSessionState(session.state) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'observe-failed'
    if (message.includes('already has a writer')) return { ok: false, code: 'journal-locked' }
    return { ok: false, code: 'observe-failed' }
  } finally {
    journal.releaseWriter()
  }
}

type LiveSessionState = { revision: number; lastSummary: MeetingSessionSummary | null }

export type ObserveLineView = {
  seq: number
  speaker: string
  text: string
  at: number
  ownEcho?: boolean
}

/** Live observe coordinator: runtime + bounded store + rolling summary cadence. */
export class MeetingObserveCoordinator {
  private readonly runtime = new MeetingSessionRuntime()
  private readonly store = new MeetingTranscriptStore()
  private readonly live = new Map<string, LiveSessionState>()

  constructor(
    private readonly rootFor: (workspaceId: string) => string | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(args: { workspaceId: string; meetingId: string; transport?: MeetingSessionTransport; url?: string; sessionId?: string }): ObserveNativeResult {
    const root = this.rootFor(args.workspaceId)
    if (!root) return { ok: false, code: 'config-dir-required' }
    const current = readLatestObserveSession(root, args.meetingId) ?? this.latestLive(args.meetingId)
    if (current && isActiveSessionState(current.state)) {
      const session = this.runtime.get(current.sessionId) ?? current
      return { ok: true, session, observing: true }
    }
    const sessionId = args.sessionId ?? `observe-${args.meetingId}-${this.now()}`
    const opened = this.runtime.open({
      sessionId,
      workspaceId: args.workspaceId,
      meetingId: args.meetingId,
      transport: args.transport ?? OBSERVE_TRANSPORT_DEFAULT,
      url: args.url ?? args.meetingId,
      now: this.now(),
    })
    if (!opened.ok) return { ok: false, code: opened.code }
    const joined = this.runtime.transition(sessionId, 'in_call', this.now())
    const session = joined.ok ? joined.session : opened.session
    this.live.set(sessionId, { revision: 0, lastSummary: null })
    if (!this.persist(session)) return { ok: false, code: 'observe-failed' }
    return { ok: true, session, observing: true }
  }

  stop(args: { workspaceId: string; meetingId: string }): ObserveNativeResult {
    const session = this.currentSession(args.workspaceId, args.meetingId)
    if (!session) return { ok: false, code: 'session-not-found' }
    const ended = this.runtime.transition(session.sessionId, 'ended', this.now())
    const record = ended.ok ? ended.session : { ...session, state: 'ended' as const, endedAt: this.now() }
    this.store.markEnded(session.sessionId)
    if (!this.persist(record)) return { ok: false, code: 'observe-failed' }
    return { ok: true, session: record, observing: false }
  }

  state(args: { workspaceId: string; meetingId: string }): ObserveNativeResult {
    const session = this.currentSession(args.workspaceId, args.meetingId)
    if (!session) return { ok: false, code: 'session-not-found' }
    return { ok: true, session, observing: isActiveSessionState(session.state) }
  }

  appendLine(sessionId: string, input: AppendInput): { accepted: boolean; line?: ObserveTranscriptLine; duplicate: boolean } {
    const result = this.store.append(sessionId, input)
    if (result.accepted) {
      const state = this.live.get(sessionId)
      if (state) state.revision += 1
      const session = this.runtime.get(sessionId)
      if (session) {
        this.runtime.patch(sessionId, {
          lineCount: this.store.lineCount(sessionId),
          cursor: { tailKeys: this.store.tailKeys(sessionId) },
          transcriptEvicted: this.store.isEvicted(sessionId),
        })
      }
      return { accepted: true, line: result.line, duplicate: false }
    }
    return { accepted: false, duplicate: result.duplicate }
  }

  transcriptLines(meetingId: string, afterSeq?: number): ObserveLineView[] {
    const session = this.latestLive(meetingId)
    if (!session) return []
    return this.store.lines(session.sessionId, afterSeq).map((line) => ({
      seq: line.seq,
      speaker: line.speaker,
      text: line.text,
      at: line.at,
      ...(line.ownEcho ? { ownEcho: true } : {}),
    }))
  }

  evictions(): TranscriptEviction[] {
    return this.store.drainEvictions()
  }

  /** Latest rolling summary for the meeting, preferring the live cache. */
  summary(args: { workspaceId: string; meetingId: string }): { summary: string; updatedAt: number } | null {
    const live = this.latestLive(args.meetingId)
    const cached = live ? this.live.get(live.sessionId)?.lastSummary : null
    if (cached) return { summary: cached.text, updatedAt: cached.updatedAt }
    const root = this.rootFor(args.workspaceId)
    if (!root) return null
    try {
      const snapshot = new MeetingJournal(root, { readOnly: true }).read(args.meetingId)
      const summaries = Object.values(snapshot.summaries).sort((a, b) => b.updatedAt - a.updatedAt)
      const latest = summaries[0]
      return latest ? { summary: latest.text, updatedAt: latest.updatedAt } : null
    } catch {
      return null
    }
  }

  async generateSummary(args: {
    workspaceId: string
    meetingId: string
    model?: SummaryModelStep
  }): Promise<MeetingSessionSummary | null> {
    const session = this.currentSession(args.workspaceId, args.meetingId)
    if (!session) return null
    const state = this.live.get(session.sessionId) ?? { revision: 0, lastSummary: null }
    const summary = await runSummaryCadence({
      session,
      revision: state.revision,
      lines: this.store.lines(session.sessionId),
      now: this.now(),
      previous: state.lastSummary,
      ...(args.model ? { model: args.model } : {}),
    })
    state.lastSummary = summary
    this.live.set(session.sessionId, state)
    this.persistSummary(session, summary)
    return summary
  }

  private latestLive(meetingId: string): MeetingSessionRecord | null {
    const records = this.runtime.list().filter((session) => session.meetingId === meetingId)
    if (!records.length) return null
    return records.sort((a, b) => b.updatedAt - a.updatedAt)[0]!
  }

  private currentSession(workspaceId: string, meetingId: string): MeetingSessionRecord | null {
    const live = this.latestLive(meetingId)
    if (live) return live
    const root = this.rootFor(workspaceId)
    if (!root) return null
    return readLatestObserveSession(root, meetingId)
  }

  private persist(session: MeetingSessionRecord): boolean {
    const root = this.rootFor(session.workspaceId)
    if (!root) return false
    const journal = new MeetingJournal(root)
    try {
      const snapshot = journal.read(session.meetingId)
      journal.commit({
        workspaceId: session.workspaceId,
        meetingId: session.meetingId,
        expectedRevision: snapshot.meeting.revision,
        commandId: `observe-live-${session.sessionId}-${snapshot.meeting.revision}`,
        events: [{ type: 'session.upsert', session }],
        outboxEntries: [],
      })
      return true
    } catch {
      return false
    } finally {
      journal.releaseWriter()
    }
  }

  private persistSummary(session: MeetingSessionRecord, summary: MeetingSessionSummary): boolean {
    const root = this.rootFor(session.workspaceId)
    if (!root) return false
    const journal = new MeetingJournal(root)
    try {
      const snapshot = journal.read(session.meetingId)
      journal.commit({
        workspaceId: session.workspaceId,
        meetingId: session.meetingId,
        expectedRevision: snapshot.meeting.revision,
        commandId: `observe-summary-${summary.sessionId}-${summary.windowStartMs}-${summary.revision}`,
        events: [{ type: 'summary.upsert', summary }],
        outboxEntries: [],
      })
      return true
    } catch {
      return false
    } finally {
      journal.releaseWriter()
    }
  }
}