/**
 * Deep-work («Фокус») session state shared by the Focus screen and the
 * renderer notification path: while a session runs, session notifications
 * are queued here instead of being shown. Global (not per workspace),
 * persisted in localStorage.
 */
import { loadWorkspaceJson, saveWorkspaceJson, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'

const NS = 'focus'
const SCOPE = 'global'

export interface FocusSession {
  startedAt: number
  endsAt: number
  minutes: number
}

export interface DeferredNotification {
  sessionId: string
  workspaceId: string
  title: string
  body?: string
  at: number
  count: number
}

export interface FocusHistoryEntry {
  date: string
  startedAt: number
  endedAt: number
  minutes: number
}

export interface FocusState {
  active: FocusSession | null
  queue: DeferredNotification[]
  history: FocusHistoryEntry[]
  /** Task ids pinned to today's top 3. */
  top3: string[]
  /** Auto-write the day summary after this local hour (null = manual only). */
  summaryHour: number | null
  /** YYYY-MM-DD of the last summary written. */
  summaryWrittenFor?: string
}

export function emptyFocusState(): FocusState {
  return { active: null, queue: [], history: [], top3: [], summaryHour: 19 }
}

export function localDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function normalizeFocusState(raw: unknown): FocusState {
  const base = emptyFocusState()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const a = r.active as Record<string, unknown> | null | undefined
  const active = a && typeof a.startedAt === 'number' && typeof a.endsAt === 'number'
    ? { startedAt: a.startedAt, endsAt: a.endsAt, minutes: typeof a.minutes === 'number' ? a.minutes : Math.round((a.endsAt - a.startedAt) / 60000) }
    : null
  return {
    active,
    queue: Array.isArray(r.queue) ? (r.queue as DeferredNotification[]).filter((q) => q && typeof q.sessionId === 'string').slice(-100) : [],
    history: Array.isArray(r.history) ? (r.history as FocusHistoryEntry[]).filter((h) => h && typeof h.startedAt === 'number').slice(-200) : [],
    top3: Array.isArray(r.top3) ? (r.top3 as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3) : [],
    summaryHour: r.summaryHour === null ? null : typeof r.summaryHour === 'number' && r.summaryHour >= 0 && r.summaryHour <= 23 ? r.summaryHour : 19,
    summaryWrittenFor: typeof r.summaryWrittenFor === 'string' ? r.summaryWrittenFor : undefined,
  }
}

export function loadFocusState(): FocusState {
  return loadWorkspaceJson(NS, SCOPE, normalizeFocusState)
}

export function saveFocusState(state: FocusState): void {
  saveWorkspaceJson(NS, SCOPE, state)
}

export function subscribeFocusState(onChange: () => void): () => void {
  return subscribeWorkspaceJson(NS, SCOPE, onChange)
}

export function isFocusRunning(state: FocusState, now: number): boolean {
  return !!state.active && now < state.active.endsAt
}

/** Cheap check for the notification path. */
export function isDeepWorkActive(now = Date.now()): boolean {
  return isFocusRunning(loadFocusState(), now)
}

export function startFocus(state: FocusState, minutes: number, now: number): FocusState {
  const settled = settleFocus(state, now)
  return { ...settled, active: { startedAt: now, endsAt: now + minutes * 60000, minutes } }
}

/** Finish the active session at `now` (or at its planned end if already past). */
export function stopFocus(state: FocusState, now: number): FocusState {
  if (!state.active) return state
  const endedAt = Math.min(now, state.active.endsAt)
  const minutes = Math.max(0, Math.round((endedAt - state.active.startedAt) / 60000))
  const entry: FocusHistoryEntry = { date: localDay(state.active.startedAt), startedAt: state.active.startedAt, endedAt, minutes }
  return { ...state, active: null, history: minutes > 0 ? [...state.history, entry].slice(-200) : state.history }
}

/** Move a session whose time is up into history. */
export function settleFocus(state: FocusState, now: number): FocusState {
  if (state.active && now >= state.active.endsAt) return stopFocus(state, now)
  return state
}

export function deferNotification(state: FocusState, item: Omit<DeferredNotification, 'count'>): FocusState {
  const existing = state.queue.find((q) => q.sessionId === item.sessionId)
  const queue = existing
    ? state.queue.map((q) => (q.sessionId === item.sessionId ? { ...q, ...item, count: q.count + 1 } : q))
    : [...state.queue, { ...item, count: 1 }]
  return { ...state, queue: queue.slice(-100) }
}

/** Called from useNotifications: returns true when the notification was queued. */
export function deferIfDeepWork(item: Omit<DeferredNotification, 'count'>, now = Date.now()): boolean {
  const state = loadFocusState()
  if (!isFocusRunning(state, now)) return false
  saveFocusState(deferNotification(state, item))
  return true
}

export function focusMinutesOn(state: FocusState, day: string, now: number): { sessions: number; minutes: number } {
  const done = state.history.filter((h) => h.date === day)
  let minutes = done.reduce((sum, h) => sum + h.minutes, 0)
  let sessions = done.length
  if (state.active && localDay(state.active.startedAt) === day) {
    minutes += Math.max(0, Math.round((Math.min(now, state.active.endsAt) - state.active.startedAt) / 60000))
    sessions += 1
  }
  return { sessions, minutes }
}
