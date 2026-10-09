/**
 * W1-14 (#1511) — Presence contract (TECH-SPEC §11.1, DATA-MODEL §5.17).
 *
 * Presence is **ephemeral**: it lives in Valkey, never in Postgres, and the
 * only state a client keeps is the last heartbeat it sent. This module is the
 * frozen shape of that contract — statuses, keys, TTLs, cadence, the topics a
 * transition is published on and the throttling rule. The server reference
 * handler (`@rox/server-core/collab`) implements it in memory; package COL
 * replaces that with Valkey without changing any name here.
 *
 * Storage schema (DATA-MODEL §5.17):
 * - `presence:{ws}:{principal}` = `{status, device, active_ref, typing_in?,
 *   last_active_at}`, TTL 60 s, refreshed by a 20 s heartbeat;
 * - `presence:obj:{ref}` = the set of principals currently viewing an object,
 *   TTL 60 s, refreshed by `presence.join`.
 *
 * Topics:
 * - a status transition is published as `presence.changed` on `user:{id}` of
 *   every principal who shares a chat or a space with the actor, at most once
 *   per 5 s per principal (§11.1);
 * - object presence is published as `presence.viewers` on
 *   `entity:{kind}:{id}` (§5 `REALTIME_EVENT_TYPES.entity`).
 */

import { type Topic } from '../events/topics.ts'
import type { EntityRef } from '../entities/refs.ts'

export const PRESENCE_STATUSES = ['online', 'away', 'dnd', 'offline'] as const

export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]

/** Presence source device (§11.1 `presence.heartbeat {status, activeRef?, device}`). */
export const PRESENCE_DEVICES = ['desktop', 'web', 'mobile', 'agent'] as const

export type PresenceDevice = (typeof PRESENCE_DEVICES)[number]

/** Clients send a heartbeat every 20 s. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000

/** A record older than the TTL (60 s) is gone: the principal reads as offline. */
export const PRESENCE_TTL_SECONDS = 60

/** `away` after 5 min without input (renderer idle detector). */
export const PRESENCE_IDLE_AWAY_MS = 5 * 60_000

/** Object presence is refreshed by the heartbeat too, and expires with it. */
export const OBJECT_PRESENCE_TTL_SECONDS = PRESENCE_TTL_SECONDS

/** `presence.changed` is throttled to one per 5 s per principal. */
export const PRESENCE_CHANGED_THROTTLE_MS = 5_000

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && (PRESENCE_STATUSES as readonly string[]).includes(value)
}

export function isPresenceDevice(value: unknown): value is PresenceDevice {
  return typeof value === 'string' && (PRESENCE_DEVICES as readonly string[]).includes(value)
}

/** Valkey key of one principal's presence record. */
export function presenceKey(workspaceId: string, principalId: string): string {
  return `presence:${workspaceId}:${principalId}`
}

/** Valkey key of one object's viewer set. */
export function objectPresenceKey(ref: EntityRef): string {
  return `presence:obj:${ref.kind}:${ref.id}${ref.fragment ? `#${ref.fragment}` : ''}`
}

/** What one `presence.heartbeat` writes. */
export interface PresenceState {
  status: PresenceStatus
  device: PresenceDevice
  /** The entity the principal is working on ("active now"), when known. */
  activeRef?: EntityRef
  /** Chat the principal is typing in; the typing indicator itself is §18.1. */
  typingIn?: string
  /** ISO-8601 of the last accepted heartbeat. */
  lastActiveAt: string
}

/** Payload of `presence.heartbeat` (TECH-SPEC §11.1). */
export interface PresenceHeartbeatPayload {
  /** Current status; the renderer derives `away` from 5 min of no input. */
  status: PresenceStatus
  device: PresenceDevice
  activeRef?: EntityRef
  typingIn?: string
}

/** Payload of `presence.join` / `presence.leave` (`{ref}`). */
export interface PresenceObjectPayload {
  ref: EntityRef
}

export interface PresenceHeartbeatResult {
  status: PresenceStatus
  /** Unix-epoch ms when the record expires (heartbeat time + TTL). */
  expiresAt: number
  /** Principal ids that receive `presence.changed` for this transition. */
  notify: string[]
}

export interface PresenceObjectResult {
  /** Principals currently viewing the object, including the caller. */
  viewers: string[]
  /** Topic the `presence.viewers` frame is published on. */
  topic: Topic
}

/**
 * The status a heartbeat implies, before the record is written.
 * `offline` is never sent by a client: it is the absence of a record.
 */
export function statusForHeartbeat(heartbeat: PresenceStatus, idleMs: number): PresenceStatus {
  if (heartbeat === 'dnd') return 'dnd'
  if (heartbeat === 'away' || idleMs >= PRESENCE_IDLE_AWAY_MS) return 'away'
  return 'online'
}

/** A status change worth publishing; `null` when nothing changed. */
export interface PresenceTransition {
  principalId: string
  from: PresenceStatus | null
  to: PresenceStatus
}

/**
 * The transition of one heartbeat against what was stored. `from = null`
 * means there was no live record (first heartbeat, or the TTL already
 * expired), which reads as a change from `offline`.
 */
export function presenceTransition(
  principalId: string,
  stored: PresenceState | null,
  next: PresenceStatus,
  now: number,
): PresenceTransition | null {
  if (stored && Date.parse(stored.lastActiveAt) + PRESENCE_TTL_SECONDS * 1000 <= now) return { principalId, from: null, to: next }
  const from = stored ? stored.status : null
  return from === next ? null : { principalId, from, to: next }
}

/**
 * `presence.changed` throttling (§11.1): at most one event per 5 s per
 * principal. The caller passes the time the previous event went out (or
 * `null`); the answer also carries the timestamp to remember.
 */
export function presenceChangedAllowed(
  previousEmittedAt: number | null,
  transition: PresenceTransition,
  now: number,
): boolean {
  if (transition.from === null && transition.to === 'online') {
    // Coming online is the one transition users actually look at; it is
    // published immediately and restarts the window.
    return true
  }
  return previousEmittedAt === null || now - previousEmittedAt >= PRESENCE_CHANGED_THROTTLE_MS
}

/**
 * Ranks presence for the merge of two sources (§11.1: the facepile merges
 * Hocuspocus awareness with `presence.join`).
 */
export const PRESENCE_STATUS_RANK: Readonly<Record<PresenceStatus, number>> = {
  dnd: 3,
  online: 2,
  away: 1,
  offline: 0,
}

/** The strongest status of a principal known from several sources. */
export function mergePresenceStatus(statuses: readonly PresenceStatus[]): PresenceStatus {
  let best: PresenceStatus = 'offline'
  for (const status of statuses) if (PRESENCE_STATUS_RANK[status] > PRESENCE_STATUS_RANK[best]) best = status
  return best
}

/** Principal ids to notify about a transition: the people who see the actor. */
export function presenceAudience(actorId: string, sharesWith: readonly string[]): string[] {
  const audience = new Set<string>()
  for (const principalId of sharesWith) if (principalId !== actorId) audience.add(principalId)
  return [...audience].sort()
}

/** Filter a raw viewer set: expired entries read as not viewing (§11.1). */
export function liveViewers(
  entries: readonly { principalId: string; seenAt: number }[],
  now: number,
): string[] {
  const ttl = OBJECT_PRESENCE_TTL_SECONDS * 1000
  const viewers = entries.filter(entry => now - entry.seenAt < ttl).map(entry => entry.principalId)
  return [...new Set(viewers)].sort()
}