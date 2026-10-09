/**
 * Pill v3 host actions (W1.4). The browser surface opens a fresh embedded
 * browser panel through the same preload path the rail uses
 * (`browserPane.createEmbedded` → `openOrFocusBrowserPanelAtom`). Kept out of
 * `pill-composition.ts` so that module stays storage-and-data only.
 */
import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { activeBrowserInstanceIdAtom } from '@/atoms/browser-pane'
import { openOrFocusBrowserPanelAtom } from '@/atoms/panel-stack'
import { openOrFocusEmbeddedBrowserPanel } from './browser-panel-lifecycle'

/** Embedded browser panels exist on Electron only (not WebUI). */
export function canOpenPillBrowser(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.browserPane)
}

/** Open (or focus) a fresh embedded browser panel. No-op when the API is absent. */
export function useOpenPillBrowser(): () => void {
  const openOrFocusBrowserPanel = useSetAtom(openOrFocusBrowserPanelAtom)
  const setActiveBrowserInstanceId = useSetAtom(activeBrowserInstanceIdAtom)
  return useCallback(() => {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI?.browserPane
    if (!api) return
    void api
      .createEmbedded({ useImportedCookies: true })
      .catch(() => api.createEmbedded())
      .then((instanceId) => {
        setActiveBrowserInstanceId(instanceId)
        openOrFocusEmbeddedBrowserPanel({ instanceId, openOrFocusBrowserPanel })
      })
      .catch((error) => {
        console.warn('[mode-pill] Failed to open a browser panel:', error)
      })
  }, [openOrFocusBrowserPanel, setActiveBrowserInstanceId])
}