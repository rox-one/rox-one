/**
 * Shared native file-row behaviour for renderer file lists: the Finder /
 * "open in app" / "copy path" / Quick Look context-menu entries, Space → Quick
 * Look on the focused row, and native drag-out via `files:startDrag`.
 *
 * Every helper is macOS + bridge gated and refuses synthetic paths (project
 * ids, `notes/…` relative references) so a row only exposes actions it can
 * actually perform.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Eye, Link2 } from 'lucide-react'
import { StyledContextMenuItem } from '@/components/ui/styled-context-menu'
import { isMac } from '@/lib/platform'
import { nativeIntegrations } from './native-integrations'

/** Only absolute filesystem paths can be handed to the OS file actions. */
export function isFilesystemPath(path: string | null | undefined): path is string {
  if (!path) return false
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Reveal in the OS file manager: prefer the frozen channel, fall back to the shipped one. */
export function revealInFinderVia(path: string): void {
  const api = nativeIntegrations()
  if (api.revealInFinder) {
    void api.revealInFinder(path)
    return
  }
  void window.electronAPI.showInFolder(path)
}

/**
 * Extra context-menu entries macOS file rows gain: open in the default app,
 * Quick Look, copy path. Rendered as fragments so callers drop them straight
 * into an existing `StyledContextMenuContent`.
 */
export function NativeFileExtraMenuItems({ path, isDirectory = false }: { path: string; isDirectory?: boolean }) {
  const { t } = useTranslation()
  const api = React.useMemo(() => nativeIntegrations(), [])
  if (!isMac || !isFilesystemPath(path)) return null
  const { openPath, quickLook, copyPath } = api
  return (
    <>
      {!isDirectory && openPath && (
        <StyledContextMenuItem onSelect={() => void openPath(path)}>
          <ExternalLink className="h-3.5 w-3.5" />
          {t('files.openInApp')}
        </StyledContextMenuItem>
      )}
      {!isDirectory && quickLook && (
        <StyledContextMenuItem onSelect={() => void quickLook(path)}>
          <Eye className="h-3.5 w-3.5" />
          {t('files.quickLook')}
        </StyledContextMenuItem>
      )}
      {copyPath && (
        <StyledContextMenuItem onSelect={() => void copyPath(path)}>
          <Link2 className="h-3.5 w-3.5" />
          {t('files.copyPath')}
        </StyledContextMenuItem>
      )}
    </>
  )
}

/**
 * Props making a file row draggable out to the OS. When the bridge is absent
 * the returned object is empty, so the row keeps its default behaviour.
 */
export function nativeFileDragProps(path: string, iconPath?: string): {
  draggable?: boolean
  onDragStart?: (event: React.DragEvent) => void
} {
  const startDrag = nativeIntegrations().startDrag
  if (!isMac || !startDrag || !isFilesystemPath(path)) return {}
  return {
    draggable: true,
    onDragStart: (event) => {
      // Electron starts the native drag from main; cancelling the DOM drag is required.
      event.preventDefault()
      void startDrag({ path, ...(iconPath ? { iconPath } : {}) })
    },
  }
}

/**
 * Space opens Quick Look on the focused row (Enter keeps the row's own
 * activation). Returns a no-op handler when Quick Look is unavailable.
 */
export function useQuickLookOnSpace(path: string, enabled = true): (event: React.KeyboardEvent) => void {
  const api = React.useMemo(() => nativeIntegrations(), [])
  return React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== ' ' || !enabled || !api.quickLook || !isFilesystemPath(path)) return
    event.preventDefault()
    void api.quickLook(path)
  }, [api, enabled, path])
}