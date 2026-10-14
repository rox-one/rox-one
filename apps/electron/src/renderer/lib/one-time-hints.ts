/**
 * One-time contextual hints (top-50 #43). A hint id is shown until the user
 * dismisses it once; dismissal persists. Ids are namespaced by screen
 * («strip.intro», «tasks.dragToList», …).
 */
import * as React from 'react'
import * as storage from '@/lib/local-storage'

type Listener = () => void
function read(): ReadonlySet<string> {
  const raw = storage.get<unknown>(storage.KEYS.screenHintsSeen, [])
  return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [])
}
let seen: ReadonlySet<string> = read()
const listeners = new Set<Listener>()

export function dismissHint(id: string): void {
  if (seen.has(id)) return
  const next = new Set(seen); next.add(id)
  seen = next
  storage.set(storage.KEYS.screenHintsSeen, [...next])
  for (const l of listeners) l()
}
export function isHintSeen(id: string): boolean { return seen.has(id) }
export function resetHints(): void { seen = new Set(); storage.set(storage.KEYS.screenHintsSeen, []); for (const l of listeners) l() }

export function useHintVisible(id: string, when = true): boolean {
  const all = React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => seen,
    () => seen,
  )
  return when && !all.has(id)
}
