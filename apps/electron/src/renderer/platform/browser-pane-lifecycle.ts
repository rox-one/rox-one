/**
 * Browser pane lifecycle — list / state / removed / interacted.
 * Extracted from BrowserTabStrip so TopBar is not the only owner (T6).
 * AppShell always mounts this; the strip calls it when it owns IPC
 * (playground, `manageLifecycle`).
 */

import { useEffect, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '@/atoms/browser-pane'

export function useBrowserPaneLifecycle(enabled = true): void {
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const updateInstance = useSetAtom(updateBrowserInstanceAtom)
  const removeInstance = useSetAtom(removeBrowserInstanceAtom)
  const [activeInstanceId, setActiveInstanceId] = useAtom(activeBrowserInstanceIdAtom)
  const instances = useAtom(browserInstancesAtom)[0]
  const instancesRef = useRef(instances)
  const removeReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    instancesRef.current = instances
  }, [instances])

  useEffect(() => {
    if (!enabled) return
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
        setActiveInstanceId((prev) => prev ?? items[0].id)
      })
      .catch((error) => {
        console.warn('[BrowserPaneLifecycle] Failed to list browser panes:', error)
        setInstances([])
        setActiveInstanceId(null)
      })
  }, [enabled, setInstances, setActiveInstanceId])

  useEffect(() => {
    if (!enabled) return
    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) return

    const cleanupState = browserPaneApi.onStateChanged((info) => {
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
            console.warn('[BrowserPaneLifecycle] Reconcile list failed after remove:', error)
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
  }, [enabled, updateInstance, removeInstance, setActiveInstanceId, setInstances])

  useEffect(() => {
    if (!enabled) return
    if (instances.length === 0) {
      setActiveInstanceId(null)
      return
    }
    if (!activeInstanceId || !instances.some((item) => item.id === activeInstanceId)) {
      setActiveInstanceId(instances[0].id)
    }
  }, [enabled, instances, activeInstanceId, setActiveInstanceId])
}
