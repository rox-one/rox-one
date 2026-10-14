/**
 * Chat folders storage — `{workspaceRootPath}/chat-folders.json`.
 * Writes are atomic and serialized per workspace within this process.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import { applyChatFoldersOp, normalizeChatFoldersState } from './ops.ts'
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
