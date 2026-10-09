/**
 * W1-14 (#1511) — Hocuspocus auth / awareness contract (TECH-SPEC §11.2, ADR-U18).
 *
 * Every shared doc edits through Yjs on `apps/collab-server`; the awareness
 * document carries nothing but what a peer needs to draw a caret, a name
 * label and a follow frame. It is **never persisted** (DATA-MODEL §5.17) and
 * never authoritative: the Y doc is.
 *
 * The contract fixes:
 * - the awareness shape (`AwarenessState`);
 * - the peer-colour rule: a stable hash of `principal_id` over 8 hues of the
 *   accent rotation at OKLCH `L 0.62 C 0.15` (UI-SPEC §18.2);
 * - the read-only rule for viewers and the content rule for commenters
 *   (`AclRole` → awareness capability);
 * - the follow frame (`viewport`) and its 100 ms scroll throttle.
 */

import type { AclRole } from '../acl/roles.ts'
import type { PresenceStatus } from './presence.ts'

export interface AwarenessUser {
  id: string
  name: string
  /** `oklch(0.62 0.15 <hue>)`; see `peerColorFor`. */
  color: string
  avatar?: string
  status?: PresenceStatus
}

/** ProseMirror selection of a peer, in document positions. */
export interface AwarenessCursor {
  anchor: number
  head: number
}

/** Alias kept for readers of TECH-SPEC §11.2 (`cursor, selection`). */
export type AwarenessSelection = AwarenessCursor

/**
 * Follow mode (§11.2): the follower scrolls to the leader's viewport with
 * `scrollIntoView`, throttled to one scroll per 100 ms.
 */
export interface AwarenessViewport {
  topBlockId: string
  offset: number
}

export interface AwarenessState {
  user: AwarenessUser
  cursor?: AwarenessCursor
  selection?: AwarenessSelection
  /** Principal this client is following (Follow mode). */
  following?: string
  /** Published only while the client is a follow leader. */
  viewport?: AwarenessViewport
}

export const FOLLOW_SCROLL_THROTTLE_MS = 100

/** How long a peer name label stays visible after the last movement (UI-SPEC §18.2). */
export const PEER_LABEL_IDLE_MS = 1_500

/**
 * The 8 peer hues of the accent rotation (UI-SPEC §18.2). Contract values:
 * the *set* is part of the design freeze, so two clients agree on a peer's
 * colour without exchanging it. `L` and `C` come from the UI-SPEC.
 */
export const PEER_COLOR_HUES = [22, 62, 108, 152, 200, 254, 306, 348] as const

export const PEER_COLOR_LIGHTNESS = 0.62
export const PEER_COLOR_CHROMA = 0.15

/** FNV-1a over the principal id: stable across processes and restarts. */
function peerHueIndex(principalId: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < principalId.length; index += 1) {
    hash ^= principalId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % PEER_COLOR_HUES.length
}

/** The colour of a peer's caret, selection and name label. */
export function peerColorFor(principalId: string): string {
  const hue = PEER_COLOR_HUES[peerHueIndex(principalId)] ?? PEER_COLOR_HUES[0]
  return `oklch(${PEER_COLOR_LIGHTNESS} ${PEER_COLOR_CHROMA} ${hue})`
}

/** One peer as the facepile and the caret layer need it. */
export interface AwarenessPeer {
  principalId: string
  name: string
  color: string
  avatar?: string
  state: AwarenessState
}

/** The peers of an awareness document, in document order of their last update. */
export function awarenessPeers(states: readonly AwarenessState[]): AwarenessPeer[] {
  const peers: AwarenessPeer[] = []
  const seen = new Set<string>()
  for (const state of states) {
    if (!state.user?.id || seen.has(state.user.id)) continue
    seen.add(state.user.id)
    peers.push({
      principalId: state.user.id,
      name: state.user.name,
      color: state.user.color || peerColorFor(state.user.id),
      ...(state.user.avatar ? { avatar: state.user.avatar } : {}),
      state,
    })
  }
  return peers
}

/** What a role may do to the shared document itself (§11.2). */
export type AwarenessCapability = 'edit' | 'suggest' | 'view'

/**
 * Hocuspocus `onAuthenticate` maps the effective ACL role to a connection:
 * `false` = refuse, otherwise the capability the connection is allowed.
 * `viewer` and `commenter` get `connection.readOnly = true`; a commenter may
 * still write the comments / suggestions maps (§11.4).
 */
export function awarenessCapabilityFor(role: AclRole | null): AwarenessCapability | null {
  switch (role) {
    case 'owner':
    case 'manager':
    case 'editor':
      return 'edit'
    case 'commenter':
      return 'suggest'
    case 'viewer':
    case 'minimal':
      return 'view'
    default:
      return null
  }
}

/** The document-only `readOnly` flag of the Hocuspocus connection. */
export function awarenessReadOnly(capability: AwarenessCapability): boolean {
  return capability !== 'edit'
}

/**
 * The `viewport` frame a follower applies: the leader's state, throttled.
 * `null` when the leader is not publishing one (no follow, or the peer is
 * gone from awareness).
 */
export function followViewport(
  peers: readonly AwarenessPeer[],
  leaderId: string,
  lastAppliedAt: number | null,
  now: number,
): AwarenessViewport | null {
  if (lastAppliedAt !== null && now - lastAppliedAt < FOLLOW_SCROLL_THROTTLE_MS) return null
  const leader = peers.find(peer => peer.principalId === leaderId)
  return leader?.state.viewport ?? null
}