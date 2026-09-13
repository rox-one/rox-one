/**
 * BrowserPanelPage
 *
 * Host surface for an embedded browser instance panel. The main process
 * composites native WebContentsViews (toolbar + page) on top of this surface;
 * this component only reports its DOM rect and focus state so main can
 * position or hide those views.
 *
 * Visibility: mounted && focused && !removed && validBounds && !suppressed.
 * Receiver: apps/electron/src/main/handlers/browser.ts → browserPaneManager.syncEmbeddedBounds.
 * Remote VPS screenshots stay in WebBrowserPanel (390×720) and are not this path.
 */

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import {
  createNativeSurfaceTracker,
  isValidNativeBounds,
} from '@/lib/native-surface-visibility'
import {
  isPanelResizeActive,
  subscribePanelResizeActivity,
} from '@/components/app-shell/resize-activity'

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
  const trackerRef = useRef(createNativeSurfaceTracker())
  const [removed, setRemoved] = useState(false)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const isFocused = panelId === undefined || focusedPanelId === panelId

  const syncBounds = useCallback(() => {
    const tracker = trackerRef.current
    const el = containerRef.current
    const rect = el ? el.getBoundingClientRect() : null
    const bounds = rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      : null
    tracker.setBounds(isValidNativeBounds(bounds) ? bounds : null)
    const decision = tracker.resolve(tracker.snapshot.generation)
    if (!decision.apply) return
    window.electronAPI.browserPane.syncBounds(instanceId, decision.rect)
  }, [instanceId])

  const scheduleSync = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    const gen = trackerRef.current.snapshot.generation
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      if (gen !== trackerRef.current.snapshot.generation) return
      syncBounds()
    })
  }, [syncBounds])

  useEffect(() => {
    const tracker = trackerRef.current
    tracker.mount()
    return () => {
      tracker.unmount()
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [])

  useEffect(() => {
    trackerRef.current.setFocused(isFocused)
    scheduleSync()
  }, [isFocused, scheduleSync])

  useEffect(() => {
    trackerRef.current.setRemoved(removed)
    scheduleSync()
  }, [removed, scheduleSync])

  useEffect(() => {
    const tracker = trackerRef.current
    const applyResize = (active: boolean) => {
      if (active) tracker.acquire('resize')
      else tracker.release('resize')
      scheduleSync()
    }
    applyResize(isPanelResizeActive())
    return subscribePanelResizeActivity(applyResize)
  }, [scheduleSync])

  useEffect(() => {
    const tracker = trackerRef.current
    const syncOverlay = () => {
      if (hasOpenOverlay()) tracker.acquire('overlay')
      else tracker.release('overlay')
      scheduleSync()
    }
    syncOverlay()
    const observer = new MutationObserver(syncOverlay)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [scheduleSync])

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

  return <div ref={containerRef} className="h-full w-full bg-background" />
}
