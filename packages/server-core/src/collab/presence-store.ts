/**
 * W1-14 (#1511) — Presence store (TECH-SPEC §11.1, DATA-MODEL §5.17).
 *
 * The reference implementation of the ephemeral presence contract: an
 * in-process store with the TTL, the 20 s heartbeat cadence and the 5 s
 * `presence.changed` throttle. Package COL replaces it with the Valkey keys of
 * §11.1 (`presence:{ws}:{principal}`, `presence:obj:{ref}`) — the interface
 * below is what it must keep.
 *
 * Nothing here is persisted: presence is deliberately not a domain event and
 * not a row (DATA-MODEL §5.17, "Ephemeral").
 */

import {
  PRESENCE_TTL_SECONDS, liveViewers, mergePresenceStatus, presenceChangedAllowed, presenceTransition, statusForHeartbeat,
  type PresenceHeartbeatPayload, type PresenceHeartbeatResult, type PresenceObjectPayload, type PresenceObjectResult, type PresenceState,
  type PresenceStatus, type PresenceTransition,
} from '@rox/core/collab'
import { entityTopic, userTopic } from '@rox/core/events'

interface StoredPresence {
  state: PresenceState
  /** Epoch ms of the last heartbeat that moved or refreshed the record. */
  seenAt: number
  /** Epoch ms of the last `presence.changed` published for this principal. */
  emittedAt: number | null
  /** Cached transition decision, consumed by the caller that publishes. */
  pending: PresenceTransition | null
}

const key = (workspaceId: string, principalId: string) => `${workspaceId}\u0000${principalId}`
const objectKey = (workspaceId: string, kind: string, id: string, fragment?: string) => `${workspaceId}\u0000${kind}:${id}${fragment ? `#${fragment}` : ''}`

export interface PresenceSnapshot {
  principalId: string
  status: PresenceStatus
  state: PresenceState | null
}

export class PresenceStore {
  private readonly presence = new Map<string, StoredPresence>()
  private readonly objects = new Map<string, Map<string, number>>()
  /** Who is told about a transition; set by the host (chat / space co-membership). */
  private audience: (workspaceId: string, principalId: string) => Promise<readonly string[]> = async () => []

  /** The server injects the co-membership lookup (see the workspace-service adapter). */
  setAudienceLookup(lookup: (workspaceId: string, principalId: string) => Promise<readonly string[]>): void {
    this.audience = lookup
  }

  /** Drop a principal's presence (disconnect, sign-out). */
  clear(workspaceId: string, principalId: string): void {
    this.presence.delete(key(workspaceId, principalId))
  }

  clearAll(): void {
    this.presence.clear()
    this.objects.clear()
  }

  /** Current status as others see it: an expired record reads as `offline`. */
  statusOf(workspaceId: string, principalId: string, now: number): PresenceStatus {
    return this.live(workspaceId, principalId, now)?.state.status ?? 'offline'
  }

  snapshot(workspaceId: string, principalIds: readonly string[], now: number): PresenceSnapshot[] {
    return principalIds.map(principalId => {
      const entry = this.live(workspaceId, principalId, now)
      return { principalId, status: entry ? entry.state.status : 'offline', state: entry ? entry.state : null }
    })
  }

  private live(workspaceId: string, principalId: string, now: number): StoredPresence | null {
    const entry = this.presence.get(key(workspaceId, principalId))
    if (!entry) return null
    return now - entry.seenAt >= PRESENCE_TTL_SECONDS * 1000 ? null : entry
  }

  async heartbeat(workspaceId: string, principalId: string, payload: PresenceHeartbeatPayload, now: number): Promise<PresenceHeartbeatResult> {
    const stored = this.live(workspaceId, principalId, now)
    const next = statusForHeartbeat(payload.status, 0)
    const transition = presenceTransition(principalId, stored?.state ?? null, next, now)
    const emit = transition ? presenceChangedAllowed(stored?.emittedAt ?? null, transition, now) : false
    const notify = emit ? [...(await this.audience(workspaceId, principalId))] : []
    const state: PresenceState = {
      status: next,
      device: payload.device,
      lastActiveAt: new Date(now).toISOString(),
      ...(payload.activeRef ? { activeRef: payload.activeRef } : stored?.state.activeRef ? { activeRef: stored.state.activeRef } : {}),
      ...(payload.typingIn ? { typingIn: payload.typingIn } : {}),
    }
    const entry: StoredPresence = {
      state,
      seenAt: now,
      emittedAt: emit ? now : stored?.emittedAt ?? null,
      pending: emit ? transition : null,
    }
    this.presence.set(key(workspaceId, principalId), entry)
    return { status: next, expiresAt: now + PRESENCE_TTL_SECONDS * 1000, notify }
  }

  /** The `presence.changed` frame the caller must publish, or `null`. */
  takeTransition(workspaceId: string, principalId: string): PresenceTransition | null {
    const entry = this.presence.get(key(workspaceId, principalId))
    if (!entry?.pending) return null
    const pending = entry.pending
    entry.pending = null
    return pending
  }

  join(workspaceId: string, principalId: string, payload: PresenceObjectPayload, now: number): PresenceObjectResult {
    const id = objectKey(workspaceId, payload.ref.kind, payload.ref.id, payload.ref.fragment)
    const viewers = this.objects.get(id) ?? new Map<string, number>()
    viewers.set(principalId, now)
    this.objects.set(id, viewers)
    return { viewers: liveViewers([...viewers].map(([viewer, seenAt]) => ({ principalId: viewer, seenAt })), now), topic: entityTopic(payload.ref) }
  }

  leave(workspaceId: string, principalId: string, payload: PresenceObjectPayload, now: number): PresenceObjectResult {
    const id = objectKey(workspaceId, payload.ref.kind, payload.ref.id, payload.ref.fragment)
    const viewers = this.objects.get(id)
    viewers?.delete(principalId)
    const live = viewers ? liveViewers([...viewers].map(([viewer, seenAt]) => ({ principalId: viewer, seenAt })), now) : []
    return { viewers: live, topic: entityTopic(payload.ref) }
  }

  /** The topic a `presence.changed` for this principal is published on. */
  changedTopic(principalId: string): string {
    return userTopic(principalId)
  }

  /** The merged status of one principal across presence sources (§11.1 facepile rule). */
  mergedStatus(workspaceId: string, principalId: string, awarenessStatus: PresenceStatus | null, now: number): PresenceStatus {
    const statuses = [this.statusOf(workspaceId, principalId, now)]
    if (awarenessStatus) statuses.push(awarenessStatus)
    return mergePresenceStatus(statuses)
  }
}