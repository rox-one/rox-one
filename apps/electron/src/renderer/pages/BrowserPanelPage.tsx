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
  const [attempt, setAttempt] = useState(0)
  const [availability, setAvailability] = useState<{ id: string; kind: 'loading' | 'ready' | 'missing' | 'unavailable' }>({ id: instanceId, kind: 'loading' })
  const kind = availability.id === instanceId ? availability.kind : 'loading'
  const removed = kind !== 'ready'
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
    let active = true
    let deleted = false
    const setKind = (kind: typeof availability.kind) => {
      if (active) setAvailability({ id: instanceId, kind })
    }
    setKind('loading')
    const offRemoved = window.electronAPI.browserPane.onRemoved((id) => {
      if (!active || id !== instanceId) return
      deleted = true
      setKind('missing')
    })
    // State broadcasts from a destroyed owner can arrive after removal.
    // The canonical list is the only authority for an initial address lookup.
    void window.electronAPI.browserPane.list().then((items) => {
      if (!active || deleted) return
      setKind(items.some((item) => item.id === instanceId) ? 'ready' : 'missing')
    }).catch(() => { if (!deleted) setKind('unavailable') })
    return () => { active = false; offRemoved() }
  }, [instanceId, attempt])

  const restorePane = useCallback(() => {
    window.dispatchEvent(new CustomEvent('craft:open-vps-browser'))
  }, [])

  const destroyGen = React.useRef(0)
  const destroyOwnerId = React.useRef(instanceId)
  useEffect(() => {
    const id = instanceId
    const gen = ++destroyGen.current
    destroyOwnerId.current = id
    return () => {
      if (persist) return
      queueMicrotask(() => {
        if (destroyGen.current !== gen && destroyOwnerId.current === id) return
        void window.electronAPI.browserPane.destroy(id).catch(() => undefined)
      })
    }
  }, [instanceId, persist])

  if (removed) {
    return (
      <div data-testid={`browser-surface-${kind}`} data-browser-instance={instanceId} role="status" className="flex flex-col items-center justify-center h-full w-full gap-3 bg-background text-muted-foreground">
        <p className="text-sm">{t(kind === 'loading' ? 'common.loading' : kind === 'missing' ? 'browser.closed' : 'common.unavailable')}</p>
        {kind !== 'loading' && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-md border px-3 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring">
            {t('common.retry')}
          </button>
        )}
        <button
          type="button"
          disabled={kind === 'loading'}
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
