import { useCallback, useEffect, useSyncExternalStore } from 'react'
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
 *
 * One shared entry per workspace: every hook instance (SessionList, the
 * Sessions second sidebar) reads the same state, so there is a single IPC load
 * and subscription, and load errors are visible to every consumer.
 */
interface Snapshot { state: ChatFoldersState; error: string | null; loading: boolean }
interface Entry { snap: Snapshot; listeners: Set<() => void>; refs: number; off?: () => void }

const EMPTY_SNAPSHOT: Snapshot = { state: EMPTY_CHAT_FOLDERS, error: null, loading: false }
const entries = new Map<string, Entry>()

function entryFor(workspaceId: string): Entry {
  let e = entries.get(workspaceId)
  if (!e) { e = { snap: { state: EMPTY_CHAT_FOLDERS, error: null, loading: true }, listeners: new Set(), refs: 0 }; entries.set(workspaceId, e) }
  return e
}

function update(workspaceId: string, patch: Partial<Snapshot> | ((s: Snapshot) => Partial<Snapshot>)) {
  const e = entries.get(workspaceId)
  if (!e) return
  e.snap = { ...e.snap, ...(typeof patch === 'function' ? patch(e.snap) : patch) }
  for (const l of e.listeners) l()
}

function load(workspaceId: string) {
  update(workspaceId, { loading: true, error: null })
  window.electronAPI.getChatFolders(workspaceId)
    .then(s => update(workspaceId, { state: s, loading: false }))
    .catch(e => update(workspaceId, { error: String(e?.message ?? e), loading: false }))
}

function acquire(workspaceId: string): () => void {
  const e = entryFor(workspaceId)
  if (e.refs++ === 0) {
    load(workspaceId)
    e.off = window.electronAPI.onChatFoldersChanged((wsId, next) => {
      if (wsId === workspaceId && next) update(workspaceId, { state: next, error: null })
    })
  }
  return () => {
    if (--e.refs === 0) { e.off?.(); entries.delete(workspaceId) }
  }
}

/** Test seam. */
export function __resetChatFoldersStoreForTests() { entries.clear() }

export function useChatFolders(workspaceId: string | undefined) {
  useEffect(() => (workspaceId ? acquire(workspaceId) : undefined), [workspaceId])

  const subscribe = useCallback((cb: () => void) => {
    if (!workspaceId) return () => {}
    const e = entryFor(workspaceId)
    e.listeners.add(cb)
    return () => { e.listeners.delete(cb) }
  }, [workspaceId])
  const snap = useSyncExternalStore(subscribe, () => (workspaceId ? entries.get(workspaceId)?.snap ?? EMPTY_SNAPSHOT : EMPTY_SNAPSHOT))

  const retry = useCallback(() => { if (workspaceId) load(workspaceId) }, [workspaceId])

  const mutate = useCallback(async (op: ChatFoldersOp): Promise<boolean> => {
    if (!workspaceId) return false
    update(workspaceId, { error: null })
    // Optimistic: validate locally first so bad input never round-trips.
    try {
      const next = applyChatFoldersOp(entryFor(workspaceId).snap.state, op)
      update(workspaceId, { state: next })
    } catch (e) {
      update(workspaceId, { error: String((e as Error)?.message ?? e) })
      return false
    }
    try {
      const next = await window.electronAPI.mutateChatFolders(workspaceId, op)
      update(workspaceId, { state: next })
      return true
    } catch (e) {
      update(workspaceId, { error: String((e as Error)?.message ?? e) })
      try { update(workspaceId, { state: await window.electronAPI.getChatFolders(workspaceId) }) } catch { /* keep optimistic */ }
      return false
    }
  }, [workspaceId])

  return { state: snap.state, mutate, error: snap.error, loading: snap.loading, retry }
}
