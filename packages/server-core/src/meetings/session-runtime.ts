/**
 * Observe session runtime (S6 / d2.2). In-process state machine plus a keyed
 * `transport:url` lock so a second window cannot observe the same call twice.
 * Pure apart from the maps it owns; journal persistence lives in observe.ts.
 */
import {
  canTransitionSession,
  emptyMeetingSession,
  isTerminalSessionState,
  sessionLockKey,
  type MeetingSessionRecord,
  type MeetingSessionState,
  type MeetingSessionTransport,
} from '@rox/core/meetings'

export type SessionRuntimeCode =
  | 'session-locked'
  | 'session-not-found'
  | 'invalid-transition'
  | 'session-terminal'

export type SessionRuntimeResult =
  | { ok: true; session: MeetingSessionRecord }
  | { ok: false; code: SessionRuntimeCode }

export type OpenSessionInput = {
  sessionId: string
  workspaceId: string
  meetingId: string
  transport: MeetingSessionTransport
  url: string
  observer?: boolean
  now?: number
}

export class MeetingSessionRuntime {
  private readonly locks = new Map<string, string>()
  private readonly sessions = new Map<string, MeetingSessionRecord>()
  private readonly lockKeys = new Map<string, string>()

  lockOwner(transport: MeetingSessionTransport, url: string): string | null {
    return this.locks.get(sessionLockKey(transport, url)) ?? null
  }

  get(sessionId: string): MeetingSessionRecord | null {
    const session = this.sessions.get(sessionId)
    return session ? { ...session } : null
  }

  list(): MeetingSessionRecord[] {
    return [...this.sessions.values()].map((session) => ({ ...session }))
  }

  open(input: OpenSessionInput): SessionRuntimeResult {
    const key = sessionLockKey(input.transport, input.url)
    const held = this.locks.get(key)
    if (held && held !== input.sessionId && !isTerminalSessionState(this.requireState(held))) {
      return { ok: false, code: 'session-locked' }
    }
    const now = input.now ?? 0
    const session = emptyMeetingSession({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      transport: input.transport,
      observer: input.observer,
      now,
    })
    session.state = 'joining'
    session.joinedAt = now
    this.sessions.set(input.sessionId, session)
    this.locks.set(key, input.sessionId)
    this.lockKeys.set(input.sessionId, key)
    return { ok: true, session: { ...session } }
  }

  /** Rehydrate a record loaded from the journal; keeps the lock when `url` is known. */
  restore(record: MeetingSessionRecord, url?: string): SessionRuntimeResult {
    this.sessions.set(record.sessionId, { ...record })
    if (url && record.transport) {
      const key = sessionLockKey(record.transport, url)
      if (!isTerminalSessionState(record.state)) {
        this.locks.set(key, record.sessionId)
        this.lockKeys.set(record.sessionId, key)
      }
    }
    return { ok: true, session: { ...record } }
  }

  transition(sessionId: string, to: MeetingSessionState, now = 0): SessionRuntimeResult {
    const current = this.sessions.get(sessionId)
    if (!current) return { ok: false, code: 'session-not-found' }
    if (isTerminalSessionState(current.state)) return { ok: false, code: 'session-terminal' }
    if (!canTransitionSession(current.state, to)) return { ok: false, code: 'invalid-transition' }
    const next: MeetingSessionRecord = { ...current, state: to, updatedAt: now }
    if (to === 'in_call' && next.joinedAt == null) next.joinedAt = now
    if (isTerminalSessionState(to)) {
      next.endedAt = now
      this.release(sessionId)
    }
    this.sessions.set(sessionId, next)
    return { ok: true, session: { ...next } }
  }

  release(sessionId: string): void {
    const key = this.lockKeys.get(sessionId)
    if (key && this.locks.get(key) === sessionId) this.locks.delete(key)
    this.lockKeys.delete(sessionId)
  }

  /** Update the record without a state transition (line counts, cursor, epoch). */
  patch(sessionId: string, patch: Partial<MeetingSessionRecord>): MeetingSessionRecord | null {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    const next = { ...current, ...patch, sessionId: current.sessionId }
    this.sessions.set(sessionId, next)
    return { ...next }
  }

  private requireState(sessionId: string): MeetingSessionState {
    return this.sessions.get(sessionId)?.state ?? 'ended'
  }
}