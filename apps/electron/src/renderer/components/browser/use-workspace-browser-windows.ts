/**
 * Workspace-scoped OS browser windows (shared by BrowserTabStrip and SurfaceTabs).
 *
 * Listing and IPC subscribe live here so hiding the TopBar strip under
 * `workbench.browser-surface.v2` does not drop the instance registry.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  filterInstancesForWorkspace,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '@/atoms/browser-pane'
import { useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import type { BrowserInstanceInfo } from '../../../shared/types'

export interface UseWorkspaceBrowserWindowsOptions {
  activeSessionId?: string | null
  instancesOverride?: BrowserInstanceInfo[]
  /** When false, skip IPC subscribe (another host owns the registry). */
  enabled?: boolean
}

export function useWorkspaceBrowserWindows({
  activeSessionId = null,
  instancesOverride,
  enabled = true,
}: UseWorkspaceBrowserWindowsOptions = {}) {
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const remoteWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? null
  const allInstances = useAtomValue(browserInstancesAtom)
  const instances = useMemo(
    () => filterInstancesForWorkspace(allInstances, activeWorkspaceId, remoteWorkspaceId),
    [allInstances, activeWorkspaceId, remoteWorkspaceId],
  )
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const updateInstance = useSetAtom(updateBrowserInstanceAtom)
  const removeInstance = useSetAtom(removeBrowserInstanceAtom)
  const [activeInstanceId, setActiveInstanceId] = useAtom(activeBrowserInstanceIdAtom)
  const effectiveInstances = useMemo(
    () => (instancesOverride ?? instances).filter((instance) => !instance.embedded),
    [instancesOverride, instances],
  )
  const instancesRef = useRef(effectiveInstances)
  const removeReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const orderedInstances = useMemo(() => {
    const items = [...effectiveInstances]
    if (activeSessionId) {
      items.sort((a, b) => {
        const aInActiveSession = a.boundSessionId === activeSessionId ? 0 : 1
        const bInActiveSession = b.boundSessionId === activeSessionId ? 0 : 1
        if (aInActiveSession !== bInActiveSession) return aInActiveSession - bInActiveSession
        return a.id.localeCompare(b.id)
      })
    } else {
      items.sort((a, b) => a.id.localeCompare(b.id))
    }
    return items
  }, [effectiveInstances, activeSessionId])

  useEffect(() => {
    instancesRef.current = effectiveInstances
  }, [effectiveInstances])

  useEffect(() => {
    if (!enabled || instancesOverride) return

    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) {
      setInstances([])
      setActiveInstanceId(null)
      return
    }

    browserPaneApi.list()
      .then((items) => {
        setInstances(items)
        if (items.length === 0) {
          setActiveInstanceId(null)
          return
        }
        setActiveInstanceId((prev) => prev ?? items[0]?.id ?? null)
      })
      .catch((error) => {
        console.warn('[BrowserTabStrip] Failed to list browser panes:', error)
        setInstances([])
        setActiveInstanceId(null)
      })
  }, [enabled, instancesOverride, setInstances, setActiveInstanceId])

  useEffect(() => {
    if (!enabled || instancesOverride) return

    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) return

    const cleanupState = browserPaneApi.onStateChanged((info: BrowserInstanceInfo) => {
      updateInstance(info)
    })

    const cleanupRemoved = browserPaneApi.onRemoved((id: string) => {
      removeInstance(id)
      setActiveInstanceId((prev) => {
        if (prev !== id) return prev
        const remaining = instancesRef.current.filter((item) => item.id !== id)
        return remaining[0]?.id ?? null
      })

      if (removeReconcileTimerRef.current) {
        clearTimeout(removeReconcileTimerRef.current)
      }

      removeReconcileTimerRef.current = setTimeout(() => {
        removeReconcileTimerRef.current = null
        void browserPaneApi.list()
          .then((items) => {
            setInstances(items)
            setActiveInstanceId((prev) => {
              if (!prev) return items[0]?.id ?? null
              return items.some((item) => item.id === prev) ? prev : (items[0]?.id ?? null)
            })
          })
          .catch((error) => {
            console.warn('[BrowserTabStrip] Reconcile list failed after remove:', error)
          })
      }, 75)
    })

    const cleanupInteracted = browserPaneApi.onInteracted((id: string) => {
      setActiveInstanceId(id)
    })

    return () => {
      cleanupState()
      cleanupRemoved()
      cleanupInteracted()
      if (removeReconcileTimerRef.current) {
        clearTimeout(removeReconcileTimerRef.current)
        removeReconcileTimerRef.current = null
      }
    }
  }, [enabled, instancesOverride, updateInstance, removeInstance, setActiveInstanceId, setInstances])

  useEffect(() => {
    if (!enabled) return
    if (orderedInstances.length === 0) {
      setActiveInstanceId(null)
      return
    }
    if (!activeInstanceId || !orderedInstances.some((item) => item.id === activeInstanceId)) {
      setActiveInstanceId(orderedInstances[0]?.id ?? null)
    }
  }, [enabled, orderedInstances, activeInstanceId, setActiveInstanceId])

  const focusBrowserWindow = useCallback((instance: BrowserInstanceInfo) => {
    setActiveInstanceId(instance.id)
    if (instancesOverride) return

    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi) {
      console.warn('[BrowserTabStrip] browserPane API unavailable for focus action')
      return
    }

    void browserPaneApi.focus(instance.id).catch((error) => {
      console.warn(`[BrowserTabStrip] Failed to focus browser window ${instance.id}:`, error)
    })
  }, [instancesOverride, setActiveInstanceId])

  const openSessionUsingWindow = useCallback((instance: BrowserInstanceInfo) => {
    const sessionId = instance.boundSessionId ?? instance.ownerSessionId
    if (!sessionId) return
    navigate(routes.view.allSessions(sessionId))
  }, [])

  const terminateBrowserWindow = useCallback((instance: BrowserInstanceInfo) => {
    if (!instancesOverride) {
      const browserPaneApi = window.electronAPI?.browserPane
      if (!browserPaneApi) {
        console.warn('[BrowserTabStrip] browserPane API unavailable for terminate action')
      } else {
        void browserPaneApi.destroy(instance.id).catch((error) => {
          console.warn(`[BrowserTabStrip] Failed to terminate browser window ${instance.id}:`, error)
        })
      }
      removeInstance(instance.id)
    }

    setActiveInstanceId((prev) => {
      if (prev !== instance.id) return prev
      const remaining = instancesRef.current.filter((item) => item.id !== instance.id)
      return remaining[0]?.id ?? null
    })
  }, [instancesOverride, removeInstance, setActiveInstanceId])

  return {
    orderedInstances,
    activeInstanceId,
    focusBrowserWindow,
    openSessionUsingWindow,
    terminateBrowserWindow,
    liveWindowActions: !instancesOverride,
  }
}
