/**
 * Ephemeral session collaboration tracker (a1.4): typing indicators and viewer
 * presence. Nothing here is persisted or grants authority — typing entries
 * expire on a TTL and viewers are dropped when their connection disconnects.
 */

import type { BroPresenceMemberDto, SessionTypingActor } from '@rox/shared/protocol'

/** Typing entries auto-expire; the client re-sends `setTyping` to keep the flag alive. */
export const SESSION_TYPING_TTL_MS = 60_000

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

interface TypingEntry {
  actor: SessionTypingActor
  timer: ReturnType<typeof setTimeout>
}

/**
 * Bounded in-memory tracker keyed by session, then by client connection. All
 * groups are pruned when they become empty, so the maps never grow without a
 * live connection to justify an entry.
 */
export class SessionActivityTracker {
  private readonly typing = new Map<string, Map<string, TypingEntry>>()
  private readonly viewers = new Map<string, Map<string, BroPresenceMemberDto>>()

  constructor(
    private readonly sink: SessionActivitySink,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = SESSION_TYPING_TTL_MS,
  ) {}

  /** Set or clear a client's typing flag for a session; only state changes emit. */
  setTyping(sessionId: string, clientId: string, actor: SessionActivityActor, typing: boolean): void {
    const group = this.typingGroup(sessionId)
    const existing = group.get(clientId)
    if (typing) {
      if (existing) {
        // Already typing: refresh the TTL without re-emitting (state unchanged).
        clearTimeout(existing.timer)
        existing.actor = { ...existing.actor, expiresAt: this.now() + this.ttlMs }
        existing.timer = this.scheduleTypingExpiry(sessionId, clientId)
      } else {
        group.set(clientId, {
          actor: { accountId: actor.accountId, displayName: actor.displayName, expiresAt: this.now() + this.ttlMs },
          timer: this.scheduleTypingExpiry(sessionId, clientId),
        })
        this.emitTyping(sessionId)
      }
      return
    }
    if (!existing) return
    clearTimeout(existing.timer)
    group.delete(clientId)
    this.emitTyping(sessionId)
    if (group.size === 0) this.typing.delete(sessionId)
  }

  private scheduleTypingExpiry(sessionId: string, clientId: string) {
    const timer = setTimeout(() => {
      this.clearTyping(sessionId, clientId)
    }, this.ttlMs)
    timer.unref?.()
    return timer
  }

  /** Register a connected viewer; a changed viewer payload emits, an identical one does not. */
  watch(sessionId: string, clientId: string, viewer: BroPresenceMemberDto): void {
    const group = this.viewers.get(sessionId) ?? new Map<string, BroPresenceMemberDto>()
    this.viewers.set(sessionId, group)
    const previous = group.get(clientId)
    group.set(clientId, viewer)
    if (previous && sameViewer(previous, viewer)) return
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
      clearTimeout(entry.timer)
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

  private clearTyping(sessionId: string, clientId: string): void {
    const group = this.typing.get(sessionId)
    const entry = group?.get(clientId)
    if (!group || !entry) return
    group.delete(clientId)
    this.emitTyping(sessionId)
    if (group.size === 0) this.typing.delete(sessionId)
  }

  private typingGroup(sessionId: string): Map<string, TypingEntry> {
    const group = this.typing.get(sessionId) ?? new Map<string, TypingEntry>()
    this.typing.set(sessionId, group)
    return group
  }

  private emitTyping(sessionId: string): void {
    const actors = [...(this.typing.get(sessionId)?.values() ?? [])].map(entry => entry.actor)
    this.sink.typingChanged(sessionId, actors)
  }

  private emitPresence(sessionId: string): void {
    this.sink.presenceChanged(sessionId, [...(this.viewers.get(sessionId)?.values() ?? [])])
  }
}

function sameViewer(a: BroPresenceMemberDto, b: BroPresenceMemberDto): boolean {
  return a.accountId === b.accountId && a.displayName === b.displayName && a.username === b.username
    && a.role === b.role && a.status === b.status
}