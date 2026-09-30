/**
 * Renderer store for the local-first team model (@craft-agent/shared/team).
 * Persists to localStorage on this device; the sync adapter decides what can
 * leave it (today: nothing — org server required).
 */
import * as React from 'react'
import {
  TEAM_FLAG,
  emptyTeamState,
  isTeamFlagEnabled,
  normalizeTeamState,
  parseTeamFlagOverrides,
  type TeamActionContext,
  type TeamFlagId,
  type TeamLocalState,
} from '@craft-agent/shared/team'

export const TEAM_STATE_STORAGE_KEY = 'rox-team-state-v1'
export const TEAM_FLAGS_STORAGE_KEY = 'rox-team-flags'

type Listener = () => void
const listeners = new Set<Listener>()
let cache: TeamLocalState | null = null

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readTeamState(): TeamLocalState {
  if (cache) return cache
  const raw = storage()?.getItem(TEAM_STATE_STORAGE_KEY)
  try {
    cache = raw ? normalizeTeamState(JSON.parse(raw)) : emptyTeamState()
  } catch {
    cache = emptyTeamState()
  }
  return cache
}

function writeTeamState(next: TeamLocalState): boolean {
  cache = next
  let persisted = false
  try {
    const store = storage()
    if (store) {
      store.setItem(TEAM_STATE_STORAGE_KEY, JSON.stringify(next))
      persisted = true
    }
  } catch {
    // Keep the in-memory draft, but do not report it as saved.
  }
  for (const l of listeners) l()
  return persisted
}

export function subscribeTeamState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function teamActionContext(selfUserId: string): TeamActionContext {
  return { selfUserId, now: Date.now(), newId }
}

/** Apply a pure reducer and persist it locally. Returns false when only memory was updated. */
export function dispatchTeam(fn: (state: TeamLocalState) => TeamLocalState): boolean {
  return writeTeamState(fn(readTeamState()))
}

export function useTeamState(): TeamLocalState {
  return React.useSyncExternalStore(subscribeTeamState, readTeamState, readTeamState)
}

export function readTeamFlagOverrides(): Record<string, boolean> {
  return parseTeamFlagOverrides(storage()?.getItem(TEAM_FLAGS_STORAGE_KEY))
}

export function useTeamFlag(id: TeamFlagId): boolean {
  return React.useMemo(() => isTeamFlagEnabled(id, readTeamFlagOverrides()), [id])
}

export { TEAM_FLAG }

/** Test hook: drop the in-memory cache. */
export function __resetTeamStoreForTests(): void {
  cache = null
  listeners.clear()
}
