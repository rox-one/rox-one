/**
 * usePages
 *
 * Loads workspace-scoped pages into `pagesAtom` and keeps them in sync via the
 * `pages:changed` broadcast (pushed whenever any page.json changes — create,
 * update, delete, content save, or a refresh-script run completing).
 *
 * Unlike `useProjects`, the atom is the ONLY state: consumers read
 * `pagesAtom` (or this hook's passthrough) and there is no duplicate local
 * list to drift.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { pagesAtom } from '@/atoms/pages'
import type { LoadedPage } from '@rox/shared/pages/types'

export interface UsePagesResult {
  pages: LoadedPage[]
  refresh: () => Promise<void>
}

export function usePages(activeWorkspaceId: string | null | undefined): UsePagesResult {
  const pages = useAtomValue(pagesAtom)
  const setPages = useSetAtom(pagesAtom)
  const owner = useRef<{ workspaceId: typeof activeWorkspaceId; revision: number; active: boolean }>({ workspaceId: activeWorkspaceId, revision: 0, active: true })

  // Clear the former workspace before descendant effects can use its pages.
  // The request owner is separate from render-time props and survives refreshes.
  useLayoutEffect(() => {
    const scope = { workspaceId: activeWorkspaceId, revision: 0, active: true }
    owner.current.active = false
    owner.current = scope
    setPages([])
    return () => { scope.active = false; scope.revision += 1 }
  }, [activeWorkspaceId, setPages])

  const refresh = useCallback(async () => {
    const scope = owner.current
    const request = ++scope.revision
    const current = () => scope.active && owner.current === scope && scope.workspaceId === activeWorkspaceId && request === scope.revision
    if (!activeWorkspaceId) {
      if (current()) setPages([])
      return
    }
    try {
      const result = await window.electronAPI.getPages(activeWorkspaceId)
      if (current()) setPages(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('[usePages] Failed to load pages:', err)
      if (current()) setPages([])
    }
  }, [activeWorkspaceId, setPages])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const scope = owner.current
    const off = window.electronAPI.onPagesChanged((wsId, list) => {
      // Watcher-driven pushes carry the CONFIG workspace id, but the WebUI
      // identifies its workspace by slug — those pushes still target this
      // client (routing is handshake-based), so on an id-form mismatch we
      // re-read instead of dropping (mirrors useAutomations' refetch shape).
      if (!scope.active || owner.current !== scope || scope.workspaceId !== activeWorkspaceId) return
      if (wsId === activeWorkspaceId) {
        // A deletion/update broadcast supersedes any earlier list request.
        scope.revision += 1
        setPages(Array.isArray(list) ? list : [])
      } else {
        void refresh()
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [activeWorkspaceId, setPages, refresh])

  return { pages, refresh }
}
