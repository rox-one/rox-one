import type { NoteSummary } from '../../../shared/types'
import { roxQueryClient } from './client'
import { roxKeys } from './keys'
import { sharedRead } from './shared-read'

/**
 * PERF-09 (#1576): Notes keeps its list and its parsed-task cache in the
 * shared query cache instead of component state, so a revisit paints the
 * last list at once and only re-reads notes whose `updatedAt` changed
 * (PERF-AUDIT B6: the task cache used to die with the page and every visit
 * re-read every note).
 *
 * The list is persisted (metadata only); the task cache stays in memory.
 */
export interface NotesTaskCache<T> {
  readonly tasks: Map<string, T[]>
  readonly updatedAt: Map<string, number>
}

export function cachedNotesList(workspaceId: string | null | undefined): NoteSummary[] | null {
  if (!workspaceId) return null
  return roxQueryClient().getQueryData<NoteSummary[]>(roxKeys.notesList(workspaceId)) ?? null
}

/**
 * Read the list and publish it to the shared cache, so Home's notes widget
 * and the Notes page paint each other's last list. Every call reads (Notes
 * refreshes after its own mutations and on change events: the newer request
 * must win), and an older read never overwrites a newer list.
 */
export function fetchNotesList(workspaceId: string, read: () => Promise<NoteSummary[]>): Promise<NoteSummary[]> {
  return sharedRead(roxQueryClient(), roxKeys.notesList(workspaceId), async () => {
    const notes = await read()
    if (!Array.isArray(notes)) throw new Error('Invalid notes list')
    return notes
  })
}

/** The workspace's task cache (one shared instance per workspace while it lives in the cache). */
export function notesTaskCache<T>(workspaceId: string | null | undefined): NotesTaskCache<T> {
  if (!workspaceId) return { tasks: new Map(), updatedAt: new Map() }
  const client = roxQueryClient()
  const key = roxKeys.notesTasks(workspaceId)
  const existing = client.getQueryData<NotesTaskCache<T>>(key)
  if (existing) return existing
  const created: NotesTaskCache<T> = { tasks: new Map(), updatedAt: new Map() }
  client.setQueryData(key, created)
  return created
}
