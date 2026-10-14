/**
 * Local error journal (top-50 #49). Uncaught errors and unhandled rejections
 * in the renderer are kept in a bounded, local-only ring (never sent
 * anywhere) so the user can see and copy them from Settings → Developers.
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

export interface JournalEntry {
  at: number
  kind: 'error' | 'rejection'
  message: string
  /** First stack lines only. */
  stack?: string
  route?: string
}

export const JOURNAL_MAX = 50
const STACK_LINES = 6
const MESSAGE_MAX = 500

function read(): JournalEntry[] {
  const raw = storage.get<unknown>(storage.KEYS.errorJournal, [])
  return Array.isArray(raw) ? (raw.filter((e) => e && typeof e === 'object' && typeof (e as JournalEntry).message === 'string') as JournalEntry[]).slice(-JOURNAL_MAX) : []
}

let entries: JournalEntry[] = read()
const listeners = new Set<() => void>()

/** Strip obvious secrets (bearer tokens, key=… query params) before storing. */
export function redact(text: string): string {
  return text
    .replace(/(bearer\s+)[\w.~+/-]+=*/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
}

/** Path only: drops query string and hash (draft input, search text, callback params). */
export function routeForJournal(route: unknown): string | undefined {
  if (route === null || route === undefined) return undefined
  const path = String(route).split(/[?#]/, 1)[0]!.slice(0, 200)
  return path ? redact(path) : undefined
}

export function toEntry(kind: JournalEntry['kind'], reason: unknown, route?: string, now = Date.now()): JournalEntry {
  const err = reason instanceof Error ? reason : null
  const message = redact(String(err ? err.message : typeof reason === 'string' ? reason : (() => { try { return JSON.stringify(reason) } catch { return String(reason) } })())).slice(0, MESSAGE_MAX)
  const stack = err?.stack ? redact(err.stack.split('\n').slice(0, STACK_LINES).join('\n')) : undefined
  const safeRoute = routeForJournal(route)
  return { at: now, kind, message: message || '(no message)', ...(stack ? { stack } : {}), ...(safeRoute ? { route: safeRoute } : {}) }
}

/** Benign browser noise that would otherwise flood the journal. */
const IGNORED = /^ResizeObserver loop/

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(): void {
  // Batch writes so an error storm does not rewrite localStorage on every event.
  if (persistTimer) return
  persistTimer = setTimeout(() => { persistTimer = null; storage.set(storage.KEYS.errorJournal, entries) }, 1000)
}

export function recordError(entry: JournalEntry): void {
  if (IGNORED.test(entry.message)) return
  // Collapse a message already seen in the last second (also alternating storms).
  for (let i = entries.length - 1; i >= 0 && entry.at - entries[i]!.at < 1000; i--) {
    if (entries[i]!.message === entry.message) return
  }
  entries = [...entries, entry].slice(-JOURNAL_MAX)
  schedulePersist()
  for (const l of listeners) l()
}

export function clearErrorJournal(): void {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  entries = []
  storage.set(storage.KEYS.errorJournal, [])
  for (const l of listeners) l()
}

export function useErrorJournal(): readonly JournalEntry[] {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => entries,
    () => entries,
  )
}

export function formatJournal(list: readonly JournalEntry[]): string {
  return list.map((e) => `[${new Date(e.at).toISOString()}] ${e.kind}${e.route ? ` @${e.route}` : ''}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`).join('\n\n')
}

let installed = false
/** Install once at boot. */
export function installErrorJournal(getRoute: () => string | undefined = () => undefined): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (event) => recordError(toEntry('error', event.error ?? event.message, getRoute())))
  window.addEventListener('unhandledrejection', (event) => recordError(toEntry('rejection', event.reason, getRoute())))
}
