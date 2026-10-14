/** Pure helpers for the chat folders list (unit-tested without React). */
import { groupSessionsByFolder, type ChatFolderGroup, type ChatFoldersState } from '@rox/shared/chat-folders'

export const CHAT_FOLDER_DRAG_MIME = 'application/x-rox-chat-session'
export const UNGROUPED_KEY = '__ungrouped__'

export function folderKey(group: ChatFolderGroup<unknown>): string {
  return group.folder?.id ?? UNGROUPED_KEY
}

export function newChatFolderId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Group + search. A query matches chat titles and folder names; a folder whose
 * name matches shows all its chats. While searching, empty folders are hidden.
 */
export function buildFolderView<T extends { id: string; lastMessageAt?: number }>(
  items: readonly T[],
  state: ChatFoldersState,
  query: string,
  titleOf: (item: T) => string,
): ChatFolderGroup<T>[] {
  const groups = groupSessionsByFolder(items, state)
  const q = query.trim().toLocaleLowerCase()
  if (!q) return groups
  const out: ChatFolderGroup<T>[] = []
  for (const g of groups) {
    const folderHit = g.folder ? g.folder.name.toLocaleLowerCase().includes(q) : false
    const hits = folderHit ? g.items : g.items.filter(i => titleOf(i).toLocaleLowerCase().includes(q))
    if (hits.length > 0 || folderHit) out.push({ folder: g.folder, items: hits })
  }
  return out
}

/** Tolerant parse of the persisted collapsed-folder list. */
export function readCollapsedFolders(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
}
