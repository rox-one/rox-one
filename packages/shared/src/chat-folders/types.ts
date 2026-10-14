/**
 * Chat folders — lightweight, user-curated grouping of chats in the sidebar.
 *
 * Unlike Projects (which bind a working directory and inject prompt context),
 * a folder is purely organisational: moving a chat into a folder never changes
 * how the agent behaves. State lives in `{workspaceRootPath}/chat-folders.json`.
 */

export interface ChatFolder {
  id: string
  name: string
  createdAt: number
}

export interface ChatFoldersState {
  version: 1
  /** Ordered folder list (display order). */
  folders: ChatFolder[]
  /** sessionId → folderId. Chats absent here are "Ungrouped". */
  assignments: Record<string, string>
}

export type ChatFoldersOp =
  | { kind: 'create'; name: string; id?: string }
  | { kind: 'rename'; folderId: string; name: string }
  | { kind: 'delete'; folderId: string }
  | { kind: 'move'; sessionIds: string[]; folderId: string | null }
  | { kind: 'reorder'; folderIds: string[] }

export const EMPTY_CHAT_FOLDERS: ChatFoldersState = { version: 1, folders: [], assignments: {} }

export const CHAT_FOLDER_NAME_MAX = 80
export const CHAT_FOLDERS_MAX = 500
