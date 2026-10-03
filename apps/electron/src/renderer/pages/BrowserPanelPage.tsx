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
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { useNativeSurfaceBounds } from '@/hooks/useNativeSurfaceBounds'
import { NativeSurfacePlaceholder } from '@/components/browser/NativeSurfacePlaceholder'

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
  const [removed, setRemoved] = useState(false)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const shell = useOptionalAppShellContext()
  const isFocused = shell?.isFocusedPanel ?? (panelId === undefined || focusedPanelId === panelId)
  const presentation = useNativeSurfaceBounds({
    containerRef,
    instanceId,
    focused: isFocused,
    removed,
    syncBounds: (id, rect) => window.electronAPI.browserPane.syncBounds(id, rect),
  })

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

  return (
    <div ref={containerRef} className="relative h-full w-full bg-background">
      <NativeSurfacePlaceholder presentation={presentation} surfaceRef={containerRef} />
    </div>
  )
}
