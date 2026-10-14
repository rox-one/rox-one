/**
 * Shell-level screen-reader announcer (demo borrowing #42).
 *
 * One persistent pair of visually hidden live regions lives in the app shell
 * (see `Announcer.tsx`). Features call `announce()` with a short summary
 * instead of marking large, frequently re-rendered panels `aria-live`, which
 * makes screen readers re-read whole lists on every update.
 */
export type AnnouncePoliteness = 'polite' | 'assertive'

export interface Announcement {
  id: number
  message: string
  politeness: AnnouncePoliteness
}

type Listener = (announcement: Announcement) => void

const listeners = new Set<Listener>()
let nextId = 1

/** Announce a short message. Empty / whitespace-only messages are ignored. */
export function announce(message: string, politeness: AnnouncePoliteness = 'polite'): void {
  const text = message.trim()
  if (!text) return
  const announcement: Announcement = { id: nextId++, message: text, politeness }
  for (const listener of listeners) listener(announcement)
}

/** Subscribe to announcements. Returns an unsubscribe function. */
export function subscribeAnnouncements(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
