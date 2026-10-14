/** Pure, validated operations on ChatFoldersState (no I/O). */
import {
  CHAT_FOLDERS_MAX,
  CHAT_FOLDER_NAME_MAX,
  EMPTY_CHAT_FOLDERS,
  type ChatFolder,
  type ChatFoldersOp,
  type ChatFoldersState,
} from './types.ts'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function isValidChatSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id) && !RESERVED_KEYS.has(id) && !/^\.+$/.test(id)
}

/** Null-prototype copy so session ids can never collide with Object.prototype. */
function cloneAssignments(src: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const [k, v] of Object.entries(src)) out[k] = v
  return out
}

export function normalizeFolderName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('chatFolders: name must be a string')
  // Collapse whitespace / control chars; names are user-authored, shown verbatim.
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('chatFolders: name is required')
  return name.length > CHAT_FOLDER_NAME_MAX ? name.slice(0, CHAT_FOLDER_NAME_MAX) : name
}

/** Coerce arbitrary parsed JSON into a valid state; drops anything malformed. */
export function normalizeChatFoldersState(raw: unknown): ChatFoldersState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CHAT_FOLDERS, folders: [], assignments: {} }
  const input = raw as Partial<ChatFoldersState>
  const folders: ChatFolder[] = []
  const seen = new Set<string>()
  for (const f of Array.isArray(input.folders) ? input.folders : []) {
    if (!f || typeof f !== 'object') continue
    if (typeof f.id !== 'string' || !ID_RE.test(f.id) || seen.has(f.id)) continue
    let name: string
    try { name = normalizeFolderName(f.name) } catch { continue }
    seen.add(f.id)
    folders.push({ id: f.id, name, createdAt: typeof f.createdAt === 'number' && Number.isFinite(f.createdAt) ? f.createdAt : 0 })
    if (folders.length >= CHAT_FOLDERS_MAX) break
  }
  const assignments: Record<string, string> = Object.create(null)
  const rawAssignments = input.assignments
  if (rawAssignments && typeof rawAssignments === 'object' && !Array.isArray(rawAssignments)) {
    for (const [sessionId, folderId] of Object.entries(rawAssignments)) {
      if (!isValidChatSessionId(sessionId) || typeof folderId !== 'string' || !seen.has(folderId)) continue
      assignments[sessionId] = folderId
    }
  }
  return { version: 1, folders, assignments }
}

function newFolderId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Apply one op, returning a new state. Throws on invalid input. */
export function applyChatFoldersOp(
  state: ChatFoldersState,
  op: ChatFoldersOp,
  now: number = Date.now(),
): ChatFoldersState {
  if (!op || typeof op !== 'object') throw new Error('chatFolders: op is required')
  const folders = state.folders.slice()
  const assignments = cloneAssignments(state.assignments)
  const has = (id: unknown): id is string => typeof id === 'string' && folders.some(f => f.id === id)
  switch (op.kind) {
    case 'create': {
      if (folders.length >= CHAT_FOLDERS_MAX) throw new Error('chatFolders: too many folders')
      const id = op.id ?? newFolderId()
      if (!ID_RE.test(id) || has(id)) throw new Error('chatFolders: invalid folder id')
      folders.push({ id, name: normalizeFolderName(op.name), createdAt: now })
      break
    }
    case 'rename': {
      const idx = folders.findIndex(f => f.id === op.folderId)
      if (idx < 0) throw new Error('chatFolders: folder not found')
      folders[idx] = { ...folders[idx]!, name: normalizeFolderName(op.name) }
      break
    }
    case 'delete': {
      const idx = folders.findIndex(f => f.id === op.folderId)
      if (idx < 0) throw new Error('chatFolders: folder not found')
      folders.splice(idx, 1)
      // Chats in a deleted folder fall back to Ungrouped — never deleted.
      for (const [sid, fid] of Object.entries(assignments)) if (fid === op.folderId) delete assignments[sid]
      break
    }
    case 'move': {
      if (!Array.isArray(op.sessionIds) || op.sessionIds.length === 0) throw new Error('chatFolders: sessionIds required')
      if (op.sessionIds.length > 5000) throw new Error('chatFolders: too many sessions')
      if (op.folderId !== null && !has(op.folderId)) throw new Error('chatFolders: folder not found')
      for (const sid of op.sessionIds) {
        if (!isValidChatSessionId(sid)) throw new Error('chatFolders: invalid session id')
        if (op.folderId === null) delete assignments[sid]
        else assignments[sid] = op.folderId
      }
      break
    }
    case 'reorder': {
      if (!Array.isArray(op.folderIds)) throw new Error('chatFolders: folderIds required')
      const byId = new Map(folders.map(f => [f.id, f]))
      const ordered: ChatFolder[] = []
      for (const id of op.folderIds) {
        const f = typeof id === 'string' ? byId.get(id) : undefined
        if (f) { ordered.push(f); byId.delete(id) }
      }
      // Unlisted folders keep their relative order at the end.
      for (const f of folders) if (byId.has(f.id)) ordered.push(f)
      folders.splice(0, folders.length, ...ordered)
      break
    }
    case 'restore': {
      if (folders.length >= CHAT_FOLDERS_MAX) throw new Error('chatFolders: too many folders')
      if (!ID_RE.test(op.folderId) || has(op.folderId)) throw new Error('chatFolders: invalid folder id')
      if (!Array.isArray(op.sessionIds) || op.sessionIds.length > 5000) throw new Error('chatFolders: invalid sessionIds')
      const index = Number.isInteger(op.index) ? Math.min(Math.max(op.index, 0), folders.length) : folders.length
      folders.splice(index, 0, { id: op.folderId, name: normalizeFolderName(op.name), createdAt: now })
      for (const sid of op.sessionIds) {
        if (!isValidChatSessionId(sid)) throw new Error('chatFolders: invalid session id')
        // Do not steal chats the user re-filed elsewhere after the delete.
        if (!Object.prototype.hasOwnProperty.call(assignments, sid)) assignments[sid] = op.folderId
      }
      break
    }
    default:
      throw new Error('chatFolders: unknown op')
  }
  return { version: 1, folders, assignments }
}

export interface ChatFolderGroup<T> {
  /** null = Ungrouped bucket */
  folder: ChatFolder | null
  items: T[]
}

/**
 * Bucket sessions into folders (in folder order) + trailing Ungrouped.
 * Empty folders are kept (so a freshly created folder is visible); the
 * Ungrouped bucket is included only when non-empty or no folders exist.
 * Assignments pointing at missing folders fall back to Ungrouped.
 */
export function groupSessionsByFolder<T extends { id: string; lastMessageAt?: number }>(
  items: readonly T[],
  state: ChatFoldersState,
): ChatFolderGroup<T>[] {
  const groups = new Map<string, T[]>(state.folders.map(f => [f.id, []]))
  const ungrouped: T[] = []
  for (const item of items) {
    const fid = Object.prototype.hasOwnProperty.call(state.assignments, item.id) ? state.assignments[item.id] : undefined
    const bucket = fid ? groups.get(fid) : undefined
    if (bucket) bucket.push(item)
    else ungrouped.push(item)
  }
  const byRecent = (a: T, b: T) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  const out: ChatFolderGroup<T>[] = state.folders.map(f => ({ folder: f, items: groups.get(f.id)!.sort(byRecent) }))
  if (ungrouped.length > 0 || out.length === 0) out.push({ folder: null, items: ungrouped.sort(byRecent) })
  return out
}

/** Keep only assignments whose session id passes `keep`; returns the same object when unchanged. */
export function pruneAssignments(state: ChatFoldersState, keep: (sessionId: string) => boolean): ChatFoldersState {
  let changed = false
  const assignments = cloneAssignments(state.assignments)
  for (const sid of Object.keys(assignments)) {
    if (!keep(sid)) { delete assignments[sid]; changed = true }
  }
  return changed ? { version: 1, folders: state.folders.slice(), assignments } : state
}
