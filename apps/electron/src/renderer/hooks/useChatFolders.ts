import { useCallback, useEffect, useState } from 'react'
import {
  EMPTY_CHAT_FOLDERS,
  applyChatFoldersOp,
  type ChatFoldersOp,
  type ChatFoldersState,
} from '@rox/shared/chat-folders'

/**
 * Workspace chat folders: loads `chat-folders.json` via RPC, applies ops
 * optimistically, and follows `chatFolders:changed` broadcasts from other
 * windows. On a failed mutation the server state is re-fetched.
 */
export function useChatFolders(workspaceId: string | undefined) {
  const [state, setState] = useState<ChatFoldersState>(EMPTY_CHAT_FOLDERS)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setState(EMPTY_CHAT_FOLDERS)
    if (!workspaceId) return
    let alive = true
    window.electronAPI.getChatFolders(workspaceId)
      .then(s => { if (alive) setState(s) })
      .catch(e => { if (alive) setError(String(e?.message ?? e)) })
    const off = window.electronAPI.onChatFoldersChanged((wsId, next) => {
      if (alive && wsId === workspaceId && next) setState(next)
    })
    return () => { alive = false; off() }
  }, [workspaceId])

  const mutate = useCallback(async (op: ChatFoldersOp): Promise<boolean> => {
    if (!workspaceId) return false
    setError(null)
    // Optimistic: validate locally first so bad input never round-trips.
    try {
      setState(prev => applyChatFoldersOp(prev, op))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      return false
    }
    try {
      const next = await window.electronAPI.mutateChatFolders(workspaceId, op)
      setState(next)
      return true
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      try { setState(await window.electronAPI.getChatFolders(workspaceId)) } catch { /* keep optimistic */ }
      return false
    }
  }, [workspaceId])

  return { state, mutate, error }
}
