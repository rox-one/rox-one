/**
 * Chat folders storage — `{workspaceRootPath}/chat-folders.json`.
 * Writes are atomic and serialized per workspace within this process.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { applyChatFoldersOp, normalizeChatFoldersState, pruneAssignments } from './ops.ts'
import type { ChatFoldersOp, ChatFoldersState } from './types.ts'

export const CHAT_FOLDERS_FILE = 'chat-folders.json'

export function chatFoldersPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, CHAT_FOLDERS_FILE)
}

export function loadChatFolders(workspaceRootPath: string): ChatFoldersState {
  const file = chatFoldersPath(workspaceRootPath)
  if (!existsSync(file)) return normalizeChatFoldersState(null)
  try {
    return normalizeChatFoldersState(readJsonFileSync(file))
  } catch {
    // Corrupt file: treat as empty rather than breaking the chat list.
    return normalizeChatFoldersState(null)
  }
}

export function saveChatFolders(workspaceRootPath: string, state: ChatFoldersState): void {
  atomicWriteFileSync(chatFoldersPath(workspaceRootPath), JSON.stringify(normalizeChatFoldersState(state), null, 2))
}

/**
 * Read-modify-write one op. Synchronous end to end, so concurrent RPCs in the
 * same process cannot interleave between the read and the write.
 */
export function mutateChatFolders(workspaceRootPath: string, op: ChatFoldersOp): ChatFoldersState {
  const next = applyChatFoldersOp(loadChatFolders(workspaceRootPath), op)
  saveChatFolders(workspaceRootPath, next)
  return next
}

/**
 * Drop assignments for the given (deleted) sessions. No write when nothing
 * changes. Best-effort callers (session delete) should catch.
 */
export function removeSessionsFromChatFolders(workspaceRootPath: string, sessionIds: readonly string[]): boolean {
  if (!existsSync(chatFoldersPath(workspaceRootPath))) return false
  const state = loadChatFolders(workspaceRootPath)
  const next = pruneAssignments(state, id => !sessionIds.includes(id))
  if (next === state) return false
  saveChatFolders(workspaceRootPath, next)
  return true
}

/**
 * Load and prune assignments whose session folder no longer exists on disk
 * (sessions deleted while this code was absent, or by another client). Only
 * runs when the sessions directory itself exists, so a missing/unmounted
 * sessions dir never wipes the mapping.
 */
export function loadChatFoldersPruned(workspaceRootPath: string): ChatFoldersState {
  const state = loadChatFolders(workspaceRootPath)
  // Same layout as workspaces/storage getWorkspaceSessionsPath (not imported: heavy module graph).
  const sessionsDir = join(workspaceRootPath, 'sessions')
  if (Object.keys(state.assignments).length === 0 || !existsSync(sessionsDir)) return state
  const next = pruneAssignments(state, id => existsSync(join(sessionsDir, id)))
  if (next !== state) {
    try { saveChatFolders(workspaceRootPath, next) } catch { /* read path stays best-effort */ }
  }
  return next
}
