/**
 * Ephemeral session collaboration tracker (a1.4): typing indicators and viewer
 * presence. Nothing here is persisted or grants authority — typing entries and
 * viewers expire on their TTL (reaped by a sweep interval) and every
 * registration is dropped when its connection disconnects.
 */

import type { BroPresenceMemberDto, SessionTypingActor } from '@rox/shared/protocol'

/** Typing entries auto-expire; the client re-sends `setTyping` to keep the flag alive. */
export const SESSION_TYPING_TTL_MS = 60_000
/** Viewers auto-expire unless they re-`watch`; `watch` is the heartbeat. */
export const SESSION_VIEWER_TTL_MS = 5 * 60_000
/** How often expired entries are reaped. */
export const SESSION_ACTIVITY_SWEEP_INTERVAL_MS = 15_000
/** Upper bound on concurrently tracked sessions; the stalest group is evicted. */
export const SESSION_ACTIVITY_MAX_SESSIONS = 512
/** Upper bound on entries tracked per session (typing actors / viewers). */
export const SESSION_ACTIVITY_MAX_ENTRIES_PER_SESSION = 64

export interface SessionActivityActor {
  accountId: string
  displayName: string
}

export interface SessionActivitySink {
  /** State change only: the current typing actors for the session. */
  typingChanged(sessionId: string, actors: SessionTypingActor[]): void
  /** State change only: the current viewers for the session. */
  presenceChanged(sessionId: string, viewers: BroPresenceMemberDto[]): void
}

export interface SessionActivityOptions {
  now?: () => number
  typingTtlMs?: number
  viewerTtlMs?: number
  sweepIntervalMs?: number
  maxSessions?: number
  maxEntriesPerSession?: number
  /** Disable the periodic sweep (tests drive `sweep()` directly). */
  sweep?: boolean
}

interface Expiring<T> {
  value: T
  expiresAt: number
}

/**
 * Bounded in-memory tracker keyed by session, then by client connection. Groups
 * are pruned when they become empty, the per-session map holds at most
 * `maxEntriesPerSession` live entries, and stale sessions are evicted once the
 * session count passes `maxSessions` — so the maps can never grow without a
 * live connection to justify an entry.
 */
export class SessionActivityTracker {
  private readonly typing = new Map<string, Map<string, Expiring<SessionTypingActor>>>()
  private readonly viewers = new Map<string, Map<string, Expiring<BroPresenceMemberDto>>>()
  private readonly now: () => number
  private readonly typingTtlMs: number
  private readonly viewerTtlMs: number
  private readonly maxSessions: number
  private readonly maxEntriesPerSession: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly sink: SessionActivitySink, options: SessionActivityOptions = {}) {
    this.now = options.now ?? Date.now
    this.typingTtlMs = options.typingTtlMs ?? SESSION_TYPING_TTL_MS
    this.viewerTtlMs = options.viewerTtlMs ?? SESSION_VIEWER_TTL_MS
    this.maxSessions = options.maxSessions ?? SESSION_ACTIVITY_MAX_SESSIONS
    this.maxEntriesPerSession = options.maxEntriesPerSession ?? SESSION_ACTIVITY_MAX_ENTRIES_PER_SESSION
    if (options.sweep !== false) {
      const interval = options.sweepIntervalMs ?? SESSION_ACTIVITY_SWEEP_INTERVAL_MS
      this.sweepTimer = setInterval(() => this.sweep(), interval)
      this.sweepTimer.unref?.()
    }
  }

  /** Stop the sweep interval (server shutdown). Registrations are left as-is. */
  dispose(): void {
    clearInterval(this.sweepTimer ?? undefined)
    this.sweepTimer = null
  }

  /** Set or clear a client's typing flag for a session; only state changes emit. */
  setTyping(sessionId: string, clientId: string, actor: SessionActivityActor, typing: boolean): void {
    const group = this.ensureGroup(this.typing, sessionId)
    const existing = group.get(clientId)
    if (typing) {
      const expiresAt = this.now() + this.typingTtlMs
      if (existing) {
        // Already typing: refresh the TTL without re-emitting (state unchanged).
        const unchanged = existing.value.accountId === actor.accountId
          && existing.value.displayName === actor.displayName
        existing.value = { accountId: actor.accountId, displayName: actor.displayName, expiresAt }
        existing.expiresAt = expiresAt
        if (unchanged) return
      } else {
        this.evictOverflow(group)
        group.set(clientId, {
          value: { accountId: actor.accountId, displayName: actor.displayName, expiresAt },
          expiresAt,
        })
      }
      this.emitTyping(sessionId)
      return
    }
    if (!existing) return
    group.delete(clientId)
    this.emitTyping(sessionId)
    if (group.size === 0) this.typing.delete(sessionId)
  }

  /** Register (or heartbeat) a connected viewer; an identical live viewer does not re-emit. */
  watch(sessionId: string, clientId: string, viewer: BroPresenceMemberDto): void {
    const group = this.ensureGroup(this.viewers, sessionId)
    const now = this.now()
    const previous = group.get(clientId)
    const expiresAt = now + this.viewerTtlMs
    if (!previous) this.evictOverflow(group)
    group.set(clientId, { value: viewer, expiresAt })
    if (previous && previous.expiresAt > now && sameViewer(previous.value, viewer)) return
    this.emitPresence(sessionId)
  }

  /** Remove a viewer registration for one session. */
  unwatch(sessionId: string, clientId: string): void {
    const group = this.viewers.get(sessionId)
    if (!group?.delete(clientId)) return
    this.emitPresence(sessionId)
    if (group.size === 0) this.viewers.delete(sessionId)
  }

  /** Drop every registration owned by a connection (typing + presence) on disconnect. */
  removeClient(clientId: string): void {
    for (const [sessionId, group] of [...this.typing]) {
      const entry = group.get(clientId)
      if (!entry) continue
      group.delete(clientId)
      this.emitTyping(sessionId)
      if (group.size === 0) this.typing.delete(sessionId)
    }
    for (const [sessionId, group] of [...this.viewers]) {
      if (!group.delete(clientId)) continue
      this.emitPresence(sessionId)
      if (group.size === 0) this.viewers.delete(sessionId)
    }
  }

  /** Reap every entry past its TTL, emitting once per session whose state changed. */
  sweep(): void {
    const now = this.now()
    for (const [sessionId, group] of [...this.typing]) {
      if (!expireGroup(group, now)) continue
      this.emitTyping(sessionId)
      if (group.size === 0) this.typing.delete(sessionId)
    }
    for (const [sessionId, group] of [...this.viewers]) {
      if (!expireGroup(group, now)) continue
      this.emitPresence(sessionId)
      if (group.size === 0) this.viewers.delete(sessionId)
    }
  }

  private ensureGroup<T>(
    map: Map<string, Map<string, Expiring<T>>>,
    sessionId: string,
  ): Map<string, Expiring<T>> {
    const existing = map.get(sessionId)
    if (existing) return existing
    if (map.size >= this.maxSessions) {
      // Evict the session whose newest entry is oldest — it is the stalest.
      let stalestId: string | undefined
      let stalestAt = Infinity
      for (const [id, group] of map) {
        const newest = Math.max(...[...group.values()].map(entry => entry.expiresAt))
        if (newest < stalestAt) { stalestAt = newest; stalestId = id }
      }
      if (stalestId !== undefined) {
        map.delete(stalestId)
        this.emitSessionEmpty(stalestId, map === this.typing)
      }
    }
    const group = new Map<string, Expiring<T>>()
    map.set(sessionId, group)
    return group
  }

  /** Keep a group at the cap by dropping its soonest-to-expire entries. */
  private evictOverflow<T>(group: Map<string, Expiring<T>>): void {
    while (group.size >= this.maxEntriesPerSession) {
      let oldestKey: string | undefined
      let oldestAt = Infinity
      for (const [key, entry] of group) {
        if (entry.expiresAt < oldestAt) { oldestAt = entry.expiresAt; oldestKey = key }
      }
      if (oldestKey === undefined) return
      group.delete(oldestKey)
    }
  }

  private emitSessionEmpty(sessionId: string, typing: boolean): void {
    if (typing) this.sink.typingChanged(sessionId, [])
    else this.sink.presenceChanged(sessionId, [])
  }

  private emitTyping(sessionId: string): void {
    const actors = [...(this.typing.get(sessionId)?.values() ?? [])].map(entry => entry.value)
    this.sink.typingChanged(sessionId, actors)
  }

  private emitPresence(sessionId: string): void {
    this.sink.presenceChanged(sessionId, [...(this.viewers.get(sessionId)?.values() ?? [])].map(entry => entry.value))
  }
}

/** Delete every entry past `now`; true when at least one was removed. */
function expireGroup<T>(group: Map<string, Expiring<T>>, now: number): boolean {
  let changed = false
  for (const [key, entry] of [...group]) {
    if (entry.expiresAt > now) continue
    group.delete(key)
    changed = true
  }
  return changed
}

function sameViewer(a: BroPresenceMemberDto, b: BroPresenceMemberDto): boolean {
  return a.accountId === b.accountId && a.displayName === b.displayName && a.username === b.username
    && a.role === b.role && a.status === b.status
}