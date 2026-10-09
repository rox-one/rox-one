/**
 * Pure model for live session collaboration signals (a2.1–a2.5).
 *
 * Kept dependency-free and framework-free so the renderer atoms, the event
 * processor and the component tests share one implementation:
 * - `reduceSessionActivityEvent` folds the ephemeral `session_typing` /
 *   `session_presence` event variants into a per-session activity map.
 * - `TypingBeacon` throttles outgoing `setTyping` beacons (one `true` per
 *   interval, one `false` on clear) so a typing user never spams the socket.
 * - `sessionInvolvesViewer` / `collectSessionOwnerOptions` back the sidebar
 *   "Involving me" / owners filter, matching on the server-attributed
 *   `creator` / `owner` / `participants` fields (client match on honest
 *   server data; never a second identity store).
 */

import type {
  BroPresenceMemberDto,
  SessionCreatedActor,
  SessionEvent,
  SessionOwnerRef,
  SessionParticipantIdentity,
  SessionTypingActor,
} from '@rox/shared/protocol'

export interface SessionActivityState {
  /** Live viewers, newest server snapshot wins. */
  viewers: BroPresenceMemberDto[]
  /** Actors currently typing (server TTL-expired entries are dropped there). */
  typingActors: SessionTypingActor[]
}

export const EMPTY_SESSION_ACTIVITY: SessionActivityState = { viewers: [], typingActors: [] }

export function readSessionActivity(
  state: ReadonlyMap<string, SessionActivityState>,
  sessionId: string,
): SessionActivityState {
  return state.get(sessionId) ?? EMPTY_SESSION_ACTIVITY
}

/**
 * Fold one ephemeral session event into the activity map. Non-activity events
 * are returned unchanged (same reference) so callers can skip a re-render.
 */
export function reduceSessionActivityEvent(
  state: ReadonlyMap<string, SessionActivityState>,
  event: SessionEvent,
): Map<string, SessionActivityState> {
  if (event.type === 'session_presence') {
    const current = state.get(event.sessionId) ?? EMPTY_SESSION_ACTIVITY
    if (sameViewers(current.viewers, event.viewers)) return state as Map<string, SessionActivityState>
    const next = new Map(state)
    if (event.viewers.length === 0 && current.typingActors.length === 0) next.delete(event.sessionId)
    else next.set(event.sessionId, { ...current, viewers: event.viewers })
    return next
  }
  if (event.type === 'session_typing') {
    const current = state.get(event.sessionId) ?? EMPTY_SESSION_ACTIVITY
    if (sameActors(current.typingActors, event.actors)) return state as Map<string, SessionActivityState>
    const next = new Map(state)
    if (event.actors.length === 0 && current.viewers.length === 0) next.delete(event.sessionId)
    else next.set(event.sessionId, { ...current, typingActors: event.actors })
    return next
  }
  return state as Map<string, SessionActivityState>
}

function sameViewers(a: readonly BroPresenceMemberDto[], b: readonly BroPresenceMemberDto[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.accountId !== y.accountId || x.status !== y.status || x.displayName !== y.displayName) return false
  }
  return true
}

function sameActors(a: readonly SessionTypingActor[], b: readonly SessionTypingActor[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.accountId !== b[i]!.accountId) return false
  }
  return true
}

/** Default re-send interval; comfortably under the server-side 60 s typing TTL. */
export const TYPING_BEACON_INTERVAL_MS = 3_000

/**
 * Viewer-watch heartbeat interval. `watchSession` is not a one-shot
 * registration: server viewer entries expire after the 5-minute viewer TTL and
 * the connection must re-`watch` to stay visible. 60 s keeps the local viewer
 * live with a wide margin against both the TTL and a dropped heartbeat.
 */
export const VIEWER_WATCH_HEARTBEAT_MS = 60_000

/**
 * Throttled typing beacon. `notify()` emits `true` at most once per interval
 * (leading edge, so the indicator appears immediately); `clear()` emits `false`
 * once. The server TTL (60 s) is refreshed by each `true`.
 */
export class TypingBeacon {
  private typing = false
  private lastSentAt = 0

  constructor(
    private readonly send: (typing: boolean) => void,
    private readonly intervalMs: number = TYPING_BEACON_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Call on user input. */
  notify(): void {
    const now = this.now()
    if (!this.typing) {
      this.typing = true
      this.lastSentAt = now
      this.send(true)
      return
    }
    if (now - this.lastSentAt >= this.intervalMs) {
      this.lastSentAt = now
      this.send(true)
    }
  }

  /** Call on send/blur/unmount. Emits `false` only when a `true` is outstanding. */
  clear(): void {
    if (!this.typing) return
    this.typing = false
    this.send(false)
  }

  get isTyping(): boolean {
    return this.typing
  }
}

// ── Viewer identity + sidebar filter ────────────────────────────────────────

/** The local viewer's identity, resolved from the Rox cloud account snapshot. */
export interface ViewerIdentity {
  accountId: string | null
  username: string | null
  displayName: string | null
}

export const EMPTY_VIEWER_IDENTITY: ViewerIdentity = { accountId: null, username: null, displayName: null }

/**
 * Resolve the local viewer from the server's self actor id and the cloud
 * account snapshot. The server id wins because it is the value the server
 * compares for session attribution and write access — on the desktop path the
 * cloud account id can never equal the local `installation` identity. Falls
 * back to the cloud account when the server id is absent (older server/offline).
 */
export function resolveViewerIdentity(input: {
  serverActorId?: string | null
  accountId?: string | null
  username?: string | null
  displayName?: string | null
}): ViewerIdentity {
  const serverActorId = input.serverActorId?.trim() || null
  return {
    accountId: serverActorId ?? input.accountId ?? null,
    username: input.username ?? null,
    displayName: input.displayName ?? serverActorId,
  }
}

export function hasViewerIdentity(viewer: ViewerIdentity): boolean {
  return Boolean(viewer.accountId || viewer.username || viewer.displayName)
}

/**
 * Drop the local viewer from a typing snapshot. The server emits every typing
 * actor including the emitter, so the composer would otherwise render e.g.
 * "Local is typing…" above the local user's own input until the server TTL
 * expires. Matching is by account id only — the authoritative key on the
 * typing actor; a viewer with no known account id filters nobody.
 */
export function filterLocalTypingActors(
  actors: readonly SessionTypingActor[],
  viewer: ViewerIdentity,
): SessionTypingActor[] {
  const accountId = viewer.accountId
  if (!accountId) return [...actors]
  return actors.filter(actor => actor.accountId !== accountId)
}

export interface SessionAttributionFields {
  creator?: SessionCreatedActor
  owner?: SessionOwnerRef
  participants?: SessionParticipantIdentity[]
}

/**
 * True when the session's server-attributed attribution references the viewer.
 * Matching is by account id (authoritative), then username, then display name.
 * A viewer with no known identity never matches.
 */
export function sessionInvolvesViewer(
  meta: SessionAttributionFields,
  viewer: ViewerIdentity,
): boolean {
  if (!hasViewerIdentity(viewer)) return false
  const accountId = viewer.accountId
  if (accountId) {
    if (meta.creator?.accountId === accountId) return true
    if (meta.owner?.id === accountId) return true
    if (meta.participants?.some(p => p.accountId === accountId)) return true
  }
  if (viewer.username && meta.participants?.some(p => p.username === viewer.username)) return true
  if (viewer.displayName) {
    if (meta.creator?.displayName === viewer.displayName) return true
    if (meta.owner?.displayName === viewer.displayName) return true
    if (meta.participants?.some(p => p.displayName === viewer.displayName)) return true
  }
  return false
}

/** Synthetic id for the "sessions without an owner" filter row. */
export const UNASSIGNED_OWNER_FILTER_ID = '__unassigned__'

export interface SessionOwnerOption {
  id: string
  displayName: string
  kind: 'account' | 'agent' | 'unassigned'
}

/**
 * Distinct owners present in the current list, using the effective owner
 * (assigned owner, else the creator — the same fallback the server enforces).
 */
export function collectSessionOwnerOptions(metas: readonly SessionAttributionFields[]): SessionOwnerOption[] {
  const seen = new Map<string, SessionOwnerOption>()
  let hasUnassigned = false
  for (const meta of metas) {
    const effectiveId = meta.owner?.id ?? meta.creator?.accountId
    if (!effectiveId) {
      hasUnassigned = true
      continue
    }
    if (seen.has(effectiveId)) continue
    seen.set(effectiveId, {
      id: effectiveId,
      displayName: meta.owner?.displayName ?? meta.creator?.displayName ?? effectiveId,
      kind: meta.owner?.kind ?? 'account',
    })
  }
  const options = [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  if (hasUnassigned) options.push({ id: UNASSIGNED_OWNER_FILTER_ID, displayName: '', kind: 'unassigned' })
  return options
}

/** Apply the owner filter (empty set = no owner filtering). */
export function sessionMatchesOwnerFilter(
  meta: SessionAttributionFields,
  selectedOwnerIds: ReadonlySet<string>,
): boolean {
  if (selectedOwnerIds.size === 0) return true
  const effectiveId = meta.owner?.id ?? meta.creator?.accountId
  if (!effectiveId) return selectedOwnerIds.has(UNASSIGNED_OWNER_FILTER_ID)
  return selectedOwnerIds.has(effectiveId)
}