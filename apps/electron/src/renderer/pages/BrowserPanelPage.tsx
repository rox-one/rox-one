/**
 * BrowserPanelPage
 *
 * Host surface for an embedded browser instance panel. The main process
 * composites native WebContentsViews (toolbar + page) on top of this surface;
 * this component only reports its DOM rect and focus state so main can
 * position or hide those views.
 */

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'

export interface BrowserPanelPageProps {
  /** Embedded browser instance id (from browserPane.createEmbedded) */
  instanceId: string
  /** Owning panel id in the panel stack (used to hide when unfocused) */
  panelId?: string
  /** When true, parent owns destroy — this surface only syncs bounds. */
  persist?: boolean
}

export default function BrowserPanelPage({ instanceId, panelId, persist = true }: BrowserPanelPageProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(0)
  const [removed, setRemoved] = useState(false)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  // Without a panelId (rendered outside the panel stack) assume focused.
  const isFocused = panelId === undefined || focusedPanelId === panelId

  // Push current bounds (or null when hidden) to the main process
  const syncBounds = useCallback(() => {
    const el = containerRef.current
    if (!el || !isFocused || removed) {
      window.electronAPI.browserPane.syncBounds(instanceId, null)
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.width < 120 || rect.height < 80) {
      window.electronAPI.browserPane.syncBounds(instanceId, null)
      return
    }
    window.electronAPI.browserPane.syncBounds(instanceId, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [instanceId, isFocused, removed])

  // rAF-throttled bounds sync
  const scheduleSync = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      syncBounds()
    })
  }, [syncBounds])

  // Observe geometry changes: element resize, window resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(el)
    window.addEventListener('resize', scheduleSync)
    scheduleSync()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleSync)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [scheduleSync])

  // Re-sync when focus or removal state flips (hide when unfocused, restore when focused)
  useEffect(() => {
    scheduleSync()
  }, [isFocused, removed, scheduleSync])

  // Track instance lifecycle: hide native views, but restore from list() instead of a dead pane.
  useEffect(() => {
    const offRemoved = window.electronAPI.browserPane.onRemoved((id) => {
      if (id === instanceId) setRemoved(true)
    })
    const offStateChanged = window.electronAPI.browserPane.onStateChanged((info) => {
      if (info.id === instanceId) setRemoved(false)
    })
    return () => {
      offRemoved()
      offStateChanged()
    }
  }, [instanceId])

  useEffect(() => {
    if (!removed) return
    let cancelled = false
    void window.electronAPI.browserPane.list().then((items) => {
      if (cancelled) return
      if (items.some((item) => item.id === instanceId)) setRemoved(false)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [removed, instanceId])

  const restorePane = useCallback(() => {
    window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))
    setRemoved(false)
  }, [])

  // Hide native views on unmount. Destroy is deferred one microtask so React
  // StrictMode remounts (dev) do not kill the instance before the second mount.
  const destroyGen = React.useRef(0)
  useEffect(() => {
    const id = instanceId
    const gen = ++destroyGen.current
    return () => {
      void window.electronAPI.browserPane.syncBounds(id, null).catch(() => undefined)
      if (persist) return
      queueMicrotask(() => {
        if (destroyGen.current !== gen) return
        void window.electronAPI.browserPane.destroy(id).catch(() => undefined)
      })
    }
  }, [instanceId, persist])

  if (removed) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3 bg-background text-muted-foreground">
        <p className="text-sm">{t('browser.closed')}</p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-foreground/5"
          onClick={restorePane}
        >
          {t('browser.restore')}
        </button>
      </div>
    )
  }

  // Full-size surface for the native views to cover
  return <div ref={containerRef} className="h-full w-full bg-background" />
}
