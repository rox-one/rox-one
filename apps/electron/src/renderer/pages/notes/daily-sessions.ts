/**
 * The day's sessions for a daily note, derived live from the session list.
 * Rendered next to the note, never written into its body, so a new or renamed
 * session cannot move the note's revision under an open editor.
 */
export type DailySessionSource = {
  id: string
  name?: string
  preview?: string
  createdAt?: number
  lastMessageAt?: number
  hidden?: boolean
  isArchived?: boolean
}

export type DailySessionItem = { id: string; name: string }

function localDateId(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dailySessionsFor(sessions: Iterable<DailySessionSource>, date: string): DailySessionItem[] {
  const items: Array<DailySessionItem & { at: number }> = []
  for (const session of sessions) {
    if (session.hidden || session.isArchived) continue
    const at = session.createdAt ?? session.lastMessageAt
    if (typeof at !== 'number' || !Number.isFinite(at) || localDateId(at) !== date) continue
    const name = (session.name?.trim() || session.preview?.trim() || session.id).replace(/\s+/g, ' ')
    items.push({ id: session.id, name, at })
  }
  return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(({ id, name }) => ({ id, name }))
}
