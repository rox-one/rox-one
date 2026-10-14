/**
 * Pure helpers for chat folders inside SessionList (unit-tested without React).
 *
 * Folders render as collapsible groups at the top of the normal chat list;
 * unfoldered chats follow under an "Ungrouped" section header, grouped by the
 * active list mode (date/status/project/…).
 */
import type { ChatFolder, ChatFoldersState } from '@rox/shared/chat-folders'
import type { EntityListGroup } from '@/components/ui/entity-list'
import { FOLDER_GROUP_PREFIX } from '@/hooks/useSessionSearch'

export { FOLDER_GROUP_PREFIX }
/** Section header for unfoldered chats; also the "remove from folder" drop target. */
export const UNGROUPED_FOLDER_KEY = `${FOLDER_GROUP_PREFIX}__none__`

/** Window event asking SessionList to expand a folder: detail `{ folderId }`. */
export const REVEAL_CHAT_FOLDER_EVENT = 'rox:sessions:reveal-folder'

export function folderGroupKey(folderId: string): string {
  return `${FOLDER_GROUP_PREFIX}${folderId}`
}

export function isFolderGroupKey(key: string): boolean {
  return key.startsWith(FOLDER_GROUP_PREFIX)
}

/** Folder id addressed by a group key: string, null (Ungrouped), or undefined (not a folder key). */
export function folderIdFromGroupKey(key: string): string | null | undefined {
  if (!isFolderGroupKey(key)) return undefined
  return key === UNGROUPED_FOLDER_KEY ? null : key.slice(FOLDER_GROUP_PREFIX.length)
}

export function newChatFolderId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Assignments restricted to folders that still exist (null-prototype map). */
export function effectiveFolderAssignments(state: ChatFoldersState): Record<string, string> {
  const live = new Set(state.folders.map(f => f.id))
  const out: Record<string, string> = Object.create(null)
  for (const [sid, fid] of Object.entries(state.assignments)) if (live.has(fid)) out[sid] = fid
  return out
}

export function folderOf(assignments: Readonly<Record<string, string>>, sessionId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(assignments, sessionId) ? assignments[sessionId] : undefined
}

export interface FolderHeaderMeta {
  kind: 'folder' | 'ungrouped'
  folder?: ChatFolder
  /** Total chats under this header (visible + collapsed). */
  count: number
}

/**
 * Prepend folder groups (in folder order, empty folders included) and an
 * Ungrouped section header before the mode groups. With no folders the mode
 * groups are returned untouched (zero visual change for users without folders).
 */
export function composeFolderGroups<T>(input: {
  folders: readonly ChatFolder[]
  folderRows: ReadonlyMap<string, T[]>
  collapsedMeta: ReadonlyArray<{ key: string; count: number }>
  modeGroups: EntityListGroup<T>[]
  ungroupedLabel: string
}): { groups: EntityListGroup<T>[]; headers: Map<string, FolderHeaderMeta> } {
  const headers = new Map<string, FolderHeaderMeta>()
  if (input.folders.length === 0) return { groups: input.modeGroups, headers }
  const groups: EntityListGroup<T>[] = []
  for (const folder of input.folders) {
    const key = folderGroupKey(folder.id)
    const items = input.folderRows.get(folder.id) ?? []
    const collapsed = input.collapsedMeta.find(m => m.key === key)
    groups.push({ key, label: folder.name, items, collapsible: true, ...(collapsed ? { collapsedCount: collapsed.count } : {}) })
    headers.set(key, { kind: 'folder', folder, count: collapsed ? collapsed.count : items.length })
  }
  const ungroupedCount = input.modeGroups.reduce((n, g) => n + (g.collapsedCount ?? g.items.length), 0)
  // Header-only group: kept permanently "collapsed" by the caller so EntityList
  // never draws an empty drop lane under it; the mode groups follow.
  groups.push({ key: UNGROUPED_FOLDER_KEY, label: input.ungroupedLabel, items: [], collapsible: true })
  headers.set(UNGROUPED_FOLDER_KEY, { kind: 'ungrouped', count: ungroupedCount })
  groups.push(...input.modeGroups)
  return { groups, headers }
}

/** Snapshot needed to undo a folder delete (folder, position, its chats). */
export interface DeletedFolderSnapshot {
  folder: ChatFolder
  index: number
  sessionIds: string[]
}

export function snapshotFolder(state: ChatFoldersState, folderId: string): DeletedFolderSnapshot | null {
  const index = state.folders.findIndex(f => f.id === folderId)
  if (index < 0) return null
  return {
    folder: state.folders[index]!,
    index,
    sessionIds: Object.entries(state.assignments).filter(([, fid]) => fid === folderId).map(([sid]) => sid),
  }
}
