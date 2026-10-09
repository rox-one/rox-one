import { hashKey } from '@tanstack/react-query'
import type { NoteSummary } from '../../../shared/types'
import { isRecentlyRead, roxQueryClient } from './client'
import { roxKeys } from './keys'
import { projectPersistedQueryData } from './persist'
import { fencedPatchQueryData, sharedRead } from './shared-read'

/**
 * PERF-09 (#1576): Notes keeps its list and its parsed-task cache in the
 * shared query cache instead of component state, so a revisit paints the
 * last list at once and only re-reads notes whose `updatedAt` changed
 * (PERF-AUDIT B6: the task cache used to die with the page and every visit
 * re-read every note).
 *
 * The cached list is metadata only (NoteSummary fields, in memory and on
 * disk): in principal mode notes.LIST returns whole NoteDocuments, and the
 * cache would otherwise keep every visited workspace's corpus alive. Callers
 * get the raw list. The task cache stays in memory.
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
 * Calls `adopt` whenever the workspace's cached list gains or changes data
 * from outside the caller (the disk restore hydrating after mount, or another
 * surface's read). Restore is async, so Notes and the Home widget, which seed
 * from the cache in their initial state, usually mount before it lands; they
 * subscribe until their own first fresh read arrives.
 */
export function subscribeCachedNotesList(workspaceId: string, adopt: (notes: NoteSummary[]) => void): () => void {
  const hash = hashKey(roxKeys.notesList(workspaceId))
  let last: unknown = roxQueryClient().getQueryData(roxKeys.notesList(workspaceId))
  return roxQueryClient().getQueryCache().subscribe(event => {
    if ((event.type !== 'added' && event.type !== 'updated') || event.query.queryHash !== hash) return
    const data = event.query.state.data
    if (!Array.isArray(data) || data === last) return
    last = data
    adopt(data as NoteSummary[])
  })
}

/**
 * Read the list and publish it to the shared cache, so Home's notes widget
 * and the Notes page paint each other's last list. An older read never
 * overwrites a newer list.
 *
 * - `mount: true` (a surface opening): joins a read already in flight, and
 *   skips the RPC when the entry was read within ROX_REVALIDATE_AFTER_MS and
 *   nothing invalidated it (the cached metadata list is returned).
 * - default (change events, after a mutation, explicit refresh): always a
 *   fresh read of its own; the newer request must win.
 */
export function fetchNotesList(workspaceId: string, read: () => Promise<NoteSummary[]>, options: { mount?: boolean } = {}): Promise<NoteSummary[]> {
  const client = roxQueryClient()
  const key = roxKeys.notesList(workspaceId)
  if (options.mount) {
    const cached = client.getQueryData<NoteSummary[]>(key)
    if (Array.isArray(cached) && isRecentlyRead(client, key)) return Promise.resolve(cached)
  }
  return sharedRead(client, key, async () => {
    const notes = await read()
    if (!Array.isArray(notes)) throw new Error('Invalid notes list')
    return notes
  }, { join: options.mount === true, store: notes => projectPersistedQueryData(key, notes) })
}

/**
 * A save or rename result patched into the cached list (metadata only),
 * fenced by the identity epoch captured when the mutation began.
 */
export function patchCachedNote(workspaceId: string, note: NoteSummary, epoch: number): boolean {
  const key = roxKeys.notesList(workspaceId)
  const [summary] = projectPersistedQueryData(key, [note]) as NoteSummary[]
  return fencedPatchQueryData<NoteSummary[]>(roxQueryClient(), key, list => {
    const index = list.findIndex(entry => entry?.id === note.id)
    if (index < 0) return list
    const next = list.slice()
    next[index] = summary!
    return next
  }, epoch)
}

/**
 * The workspace's task cache if it is already in the shared cache, without
 * creating one. A pure lookup: safe to call during render. Use
 * `ensureNotesTaskCache` where the cache must be attached (a layout effect,
 * an event handler or a task pass).
 */
export function notesTaskCache<T>(workspaceId: string | null | undefined): NotesTaskCache<T> | null {
  if (!workspaceId) return null
  return roxQueryClient().getQueryData<NotesTaskCache<T>>(roxKeys.notesTasks(workspaceId)) ?? null
}

/**
 * The workspace's shared task cache (one instance per workspace while it lives
 * in the cache), creating and registering it on first use. The registration is
 * a write to the shared cache, so never call it during render.
 */
export function ensureNotesTaskCache<T>(workspaceId: string | null | undefined): NotesTaskCache<T> {
  if (!workspaceId) return { tasks: new Map(), updatedAt: new Map() }
  const client = roxQueryClient()
  const key = roxKeys.notesTasks(workspaceId)
  const existing = client.getQueryData<NotesTaskCache<T>>(key)
  if (existing) return existing
  const created: NotesTaskCache<T> = { tasks: new Map(), updatedAt: new Map() }
  client.setQueryData(key, created)
  return created
}
