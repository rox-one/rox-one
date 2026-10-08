/**
 * ExtensionSurfacePage
 *
 * Host surface for a sandboxed extension UI panel (S-05). Mirrors
 * KnowledgeSurfacePage: the main process composites a native BrowserView on top
 * of this surface via `extensionSurface.createEmbedded` with partition
 * `persist:ext-${ws||'default'}-${extensionId}`; this component reports DOM rect
 * + focus so main can position or hide the view.
 *
 * Instance identity: durableKey `ext:${ws||'_default'}:${extensionId}:${viewId}`.
 * Each effect run owns one create/destroy pair; URL changes release before recreating.
 */

import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelIdAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNativeSurfaceBounds } from '@/hooks/useNativeSurfaceBounds'
import { NativeSurfacePlaceholder } from '@/components/browser/NativeSurfacePlaceholder'
import { releaseNativeSurface } from '@/lib/native-surface-dom'
import { toErrorMessage } from '@/lib/errors'

export interface ExtensionSurfacePageProps {
  extensionId: string
  viewId: string
  /** Owning panel id in the panel stack (used to hide when unfocused) */
  panelId?: string
  /** Explicit extension UI URL; absent URLs render an unavailable surface. */
  url?: string
}

export default function ExtensionSurfacePage({
  extensionId,
  viewId,
  panelId,
  url,
}: ExtensionSurfacePageProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const releaseRef = useRef<Promise<void>>(Promise.resolve())
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)
  const [surfaceAttempt, setSurfaceAttempt] = useState(0)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const { activeWorkspaceId, isFocusedPanel } = useAppShellContext()
  const isFocused = isFocusedPanel ?? (panelId === undefined || focusedPanelId === panelId)
  const presentation = useNativeSurfaceBounds({
    containerRef,
    instanceId,
    focused: isFocused,
    removed: removed || Boolean(error),
    syncBounds: (nativeId, rect) => window.electronAPI.extensionSurface.syncBounds({ instanceId: nativeId, rect }),
  })

  const durableKey = useMemo(() => {
    const ws =
      typeof activeWorkspaceId === 'string' && activeWorkspaceId.trim()
        ? activeWorkspaceId.trim()
        : '_default'
    return `ext:${ws}:${extensionId}:${viewId}`
  }, [activeWorkspaceId, extensionId, viewId])
  const surfaceUrl = url?.trim() ?? ''

  useEffect(() => {
    let cancelled = false
    let revoked = false
    let revision = 0
    let createdId: string | null = null
    let creation: Promise<void> | null = null
    let release: Promise<void> | null = null
    const previousRelease = releaseRef.current
    const api = window.electronAPI
    const nativeApi = api.extensionSurface
    setInstanceId(null)
    setError(null)
    setRemoved(false)

    // Catalog requests hold no native resource. Cleanup waits only for this
    // owner's creation so an unanswered lookup cannot block the next route.
    const releaseOwner = () => {
      if (!release) {
        release = previousRelease.then(async () => {
          await creation
          if (createdId === null) return
          try {
            await releaseNativeSurface(createdId, (nativeId, rect) => nativeApi.syncBounds({ instanceId: nativeId, rect }))
          } catch {
            // Best-effort hide
          }
          try {
            await nativeApi.destroy({ instanceId: createdId })
          } catch {
            // Instance may already be gone
          }
        })
        releaseRef.current = release
      }
      return release
    }
    const unavailable = (reason: string) => {
      if (cancelled || revoked) return
      revoked = true
      revision += 1
      setInstanceId(null)
      setError(reason)
      void releaseOwner()
    }
    const validate = async () => {
      const request = ++revision
      await previousRelease
      if (cancelled || revoked || request !== revision) return
      if (typeof api.extensionsListInstalled !== 'function'
        || typeof nativeApi?.createEmbedded !== 'function'
        || typeof nativeApi?.syncBounds !== 'function'
        || typeof nativeApi?.destroy !== 'function'
        || typeof nativeApi?.onRemoved !== 'function') {
        unavailable('extension-capability-unavailable')
        return
      }
      try {
        const installed = await api.extensionsListInstalled({ workspaceId: activeWorkspaceId ?? undefined })
        if (cancelled || revoked || request !== revision) return
        const record = installed.records?.find(candidate => candidate.id === extensionId)
        if (!record) {
          unavailable('extension-missing')
          return
        }
        if (record.status === 'disabled' || record.sourceEnabled === false
          || installed.state?.enabled?.[extensionId] === false) {
          unavailable('extension-disabled')
          return
        }
        if (record.manifest?.runtime !== 'craft-sandbox' && record.manifest?.runtime !== 'web-widget') {
          unavailable('extension-unsupported')
          return
        }
        try {
          const address = new URL(surfaceUrl)
          if (address.protocol === 'about:' && address.pathname === 'blank') throw new Error('Blank surface')
        } catch {
          unavailable('url-unavailable')
          return
        }
        if (!viewId.trim()) {
          unavailable('extension-view-missing')
          return
        }
        if (creation || createdId !== null) return
        creation = (async () => {
          try {
            createdId = await nativeApi.createEmbedded({ durableKey, url: surfaceUrl, extensionId, viewId, workspaceId: activeWorkspaceId })
            if (!cancelled && !revoked) setInstanceId(createdId)
          } catch (err) {
            if (!cancelled && !revoked) {
              revoked = true
              setError(toErrorMessage(err))
            }
          }
        })()
      } catch (err) {
        if (!cancelled && !revoked && request === revision) {
          unavailable(toErrorMessage(err))
        }
      }
    }
    const offChanged = api.onExtensionsChanged?.((payload) => {
      if (cancelled || revoked) return
      if (payload.workspaceId && payload.workspaceId !== activeWorkspaceId) return
      void validate()
    })
    void validate()
    return () => {
      cancelled = true
      revision += 1
      offChanged?.()
      void releaseOwner()
    }
  }, [durableKey, surfaceUrl, extensionId, viewId, activeWorkspaceId, surfaceAttempt])

  useEffect(() => {
    if (!instanceId) return
    let active = true
    const offRemoved = window.electronAPI.extensionSurface.onRemoved((removedId) => {
      // Removal is terminal for this owner. A queued state broadcast must not
      // revive a closed native view; Retry acquires a fresh instance instead.
      if (active && removedId === instanceId) setRemoved(true)
    })
    return () => {
      active = false
      offRemoved()
    }
  }, [instanceId])

  const fullSurface = (
    <div ref={containerRef} className="relative h-full w-full bg-background">
      <NativeSurfacePlaceholder presentation={presentation} surfaceRef={containerRef} />
    </div>
  )

  if (error) {
    return (
      <div className="flex flex-col gap-3 items-center justify-center h-full w-full bg-background text-muted-foreground" data-testid="extension-surface-unavailable" data-reason={error} role="status">
        <p className="text-sm">
          {error === 'url-unavailable' ? t('extensions.surface.loadUrlHint') : t('extensions.surface.error')}
        </p>
        <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={() => setSurfaceAttempt(attempt => attempt + 1)}>
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (removed) {
    return (
      <div className="flex flex-col gap-3 items-center justify-center h-full w-full bg-background text-muted-foreground" data-testid="extension-surface-removed" role="status">
        <p className="text-sm">
          {t('extensions.surface.removed')}
        </p>
        <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={() => setSurfaceAttempt(attempt => attempt + 1)}>
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (!instanceId) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background text-muted-foreground">
        <p className="text-sm">
          {t('extensions.surface.loading')}
        </p>
      </div>
    )
  }


  return fullSurface
}
