/**
 * Recent-podcasts list for the Playbooks home secondary zone (С-12, D12).
 * Renderer-local — the durable artifact metadata lives server-side with the
 * `podcast:job` receipt.
 */
export interface RecentPodcast {
  readonly id: string
  readonly notebookId: string
  readonly topic: string
  readonly engine: string
  readonly at: number
}

const STORAGE_KEY = 'rox.playbooks.podcasts.v1'
const MAX_ENTRIES = 20

export function loadRecentPodcasts(): RecentPodcast[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): RecentPodcast[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const record = entry as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.topic !== 'string' || typeof record.notebookId !== 'string') return []
      return [
        {
          id: record.id,
          notebookId: record.notebookId,
          topic: record.topic,
          engine: typeof record.engine === 'string' ? record.engine : 'system',
          at: typeof record.at === 'number' ? record.at : Date.now(),
        },
      ]
    })
  } catch {
    return []
  }
}

export function appendRecentPodcast(entry: RecentPodcast): RecentPodcast[] {
  const next = [entry, ...loadRecentPodcasts().filter((item) => item.id !== entry.id)].slice(0, MAX_ENTRIES)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* quota/unavailable */
    }
  }
  return next
}