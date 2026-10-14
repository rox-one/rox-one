/**
 * PanelSlot
 *
 * Renders a single content panel within the PanelStackContainer.
 *
 * When a panel is the only one (isOnly), it flex-grows to fill available space.
 * When multiple panels exist, each uses flex-grow with its proportion as the weight,
 * combined with min-width to prevent shrinking below PANEL_MIN_WIDTH.
 *
 * Each PanelSlot overrides AppShellContext to inject a per-panel close button
 * into PanelHeader's rightSidebarButton slot. All panels are equal — closing
 * any panel removes it from the stack. A reactive effect handles window close
 * when the stack becomes empty.
 */

import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { X, ChevronLeft } from 'lucide-react'
import { parseRouteToNavigationStateOrUnavailable } from '../../../shared/route-parser'
import { closePanelAtom, focusedPanelIdAtom, primaryPanelIdAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@rox/ui/tooltip'
import { MainContentPanel } from './MainContentPanel'
import { PANEL_MIN_WIDTH } from './panel-constants'
import { NavigationContext } from '@/contexts/NavigationContext'
import { BarePanelContext, ShellSidebarContext } from './ShellSidebarPortal'
import { destroyBrowserInstanceForRoute } from '@/platform/browser-panel-lifecycle'
import { AuxiliaryToolPanel } from './AuxiliaryToolPanel'
import { WorkspaceToolContext } from '@/atoms/workspace-context'
import { PRIMARY_NAV } from './primary-nav'

/** Header title for a grid tile: the surface the route belongs to. */
export function gridTileTitleKey(navState: Parameters<(typeof PRIMARY_NAV)[number]['isActive']>[0]): string | null {
  for (const entry of PRIMARY_NAV) {
    try {
      if (entry.isActive(navState)) return entry.labelKey
    } catch {
      // A predicate that cannot read this state simply does not match.
    }
  }
  return null
}

interface PanelSlotProps {
  entry: PanelStackEntry
  isOnly: boolean
  /** Whether this panel is the focused panel in a multi-panel layout */
  isFocusedPanel: boolean
  isSidebarAndNavigatorHidden: boolean
  /** Whether this panel touches the window's left edge (kept for callers; flush shell has no corner radii) */
  isAtLeftEdge: boolean
  /** Whether this panel's right corners touch the window edge (no right sidebar after it) */
  isAtRightEdge: boolean
  /** Flex-grow weight for proportional sizing */
  proportion: number
  /** Optional sash element rendered before this panel */
  sash?: React.ReactNode
  /** Optional flush surface stacked under the panel content (terminal panel). */
  belowContent?: React.ReactNode
  /** Compact (mobile) mode — shows back button in panel header */
  isCompact?: boolean
  /** Layout mode changes keep hidden siblings mounted and inert. */
  isHidden?: boolean
  /** Grid placement supplied by the persistent workspace container. */
  layoutStyle?: React.CSSProperties
  /** Panel strip: off-screen heavy panel unmounted until it scrolls back into view. */
  hibernated?: boolean
}

export function PanelSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isSidebarAndNavigatorHidden,
  proportion,
  sash,
  belowContent,
  isCompact,
  isHidden = false,
  layoutStyle,
  hibernated = false,
}: PanelSlotProps) {
  const { t } = useTranslation()
  const closePanel = useSetAtom(closePanelAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const parentContext = useAppShellContext()
  const navigation = useContext(NavigationContext)
  const sidebarTarget = useContext(ShellSidebarContext)
  const primaryId = useAtomValue(primaryPanelIdAtom)
  const navState = useMemo(() => parseRouteToNavigationStateOrUnavailable(entry.route), [entry.route])
  const panelRef = useRef<HTMLDivElement>(null)
  // Multi-panel grid tile: framed, titled, compact type scale (index.css).
  const gridTile = !isOnly && !isCompact && !entry.tool
  const titleKey = useMemo(() => (gridTile ? gridTileTitleKey(navState) : null), [gridTile, navState])
  const ownsSidebar = !entry.tool && (!primaryId || primaryId === entry.id)
  const tileTitle = titleKey ? t(titleKey) : null
  // A non-owner content panel in split view is a bare PANEL: no secondary sidebar.
  const [controlsSlot, setControlsSlot] = useState<HTMLElement | null>(null)
  const barePanel = useMemo(() => (gridTile && !ownsSidebar ? { title: tileTitle, titleKey, controlsSlot } : null), [gridTile, ownsSidebar, tileTitle, titleKey, controlsSlot])
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    panel.inert = isHidden
    if (isHidden && panel.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur()
  }, [isHidden])

  const handleClose = useCallback(() => {
    destroyBrowserInstanceForRoute(entry.route)
    closePanel(entry.id)
  }, [closePanel, entry.id, entry.route])

  // Build close button for PanelHeader (via context override)
  const closeButton = useMemo(() => {
    return (
      <PanelHeaderCenterButton
        icon={<X className="icon-toolbar" />}
        onClick={handleClose}
        tooltip={t("common.close")}
      />
    )
  }, [handleClose, t])

  // Build back button for compact mode — closes the panel to reveal the session list.
  // Same PanelHeaderCenterButton style as X and share, just on the left side.
  const backButton = useMemo(() => {
    if (!isCompact) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<ChevronLeft className="icon-toolbar" />}
        onClick={handleClose}
        tooltip={t("common.backToList")}
      />
    )
  }, [isCompact, handleClose, t])

  // Override AppShellContext so ChatPage/PanelHeader gets our per-panel close button,
  // back button (compact mode), and isFocusedPanel for input field appearance
  const contextOverride = useMemo(() => ({
    ...parentContext,
    panelId: entry.id,
    // A grid tile owns its close button in the tile header.
    rightSidebarButton: gridTile ? undefined : closeButton,
    leadingAction: backButton,
    isFocusedPanel,
  }), [parentContext, closeButton, backButton, isFocusedPanel, entry.id, gridTile])
  // A workspace the shell cannot serve yet keeps every panel on the provider's
  // unavailable state: no panel may claim a route from a foreign workspace.
  const panelNavigation = navigation && navState && !navigation.unavailableWorkspaceSlug
    ? { ...navigation, navigationState: navState }
    : navigation


  const handlePointerDown = useCallback(() => {
    if (!isHidden && !isFocusedPanel) {
      setFocusedPanel(entry.id)
    }
  }, [isHidden, isFocusedPanel, setFocusedPanel, entry.id])

  return (
    <>
      {sash}
      <div
        ref={panelRef}
        id={entry.id}
        aria-hidden={isHidden || undefined}
        onPointerDown={handlePointerDown}
        onFocusCapture={() => {
          if (!isHidden && !isFocusedPanel) setFocusedPanel(entry.id)
        }}
        data-panel-role="content"
        data-panel-id={entry.id}
        data-shell-role="content"
        data-compact={isCompact || undefined}
        data-auxiliary-tool={entry.tool}
        data-panel-density={gridTile ? 'grid' : undefined}
        data-panel-kind={barePanel ? 'panel' : 'screen'}
        data-focused={gridTile ? String(isFocusedPanel) : undefined}
        tabIndex={-1}
        className={cn(
          'h-full overflow-hidden relative @container/panel',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-ring',
          // One-surface shell: flush pane on the shared background. Split view
          // keeps a hairline between panels and a thin focus accent (no boxes).
          'rox-shell-pane',
          gridTile && 'rox-grid-tile',
          sash && 'rox-shell-divider-l',
          !isOnly && isFocusedPanel ? 'shadow-panel-focused z-[1]' : 'z-0',
        )}
        style={{
          // In multi-panel, unfocused panels override --background so all
          // bg-background children render at the elevated (dimmed) background.
          ...(!isFocusedPanel && !isOnly
            ? {
                '--background': 'var(--background-elevated)',
                '--shadow-minimal': 'var(--shadow-minimal-flat)',
                '--user-message-bubble': 'var(--user-message-bubble-dimmed)',
              } as React.CSSProperties
            : {}
          ),
          ...(isOnly
            ? { flexGrow: 1, minWidth: 0 }
            : {
                flexGrow: entry.tool ? 0 : proportion,
                flexShrink: entry.tool ? 0 : 1,
                flexBasis: entry.tool ? 360 : 0,
                minWidth: entry.tool ? 300 : PANEL_MIN_WIDTH,
              }
          ),
          ...layoutStyle,
          ...(isHidden ? { visibility: 'hidden', pointerEvents: 'none' } : {}),
        }}
      >
        <div className="h-full flex flex-col">
          {gridTile ? (
            <div className="rox-grid-tile-header flex shrink-0 items-center gap-1" data-testid="grid-tile-header">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
                {tileTitle ?? t('navigation.mainSurface')}
              </span>
              {/* Bare panel: the surface's navigation/filters in compact form (never a sidebar column). */}
              <div ref={setControlsSlot} className="flex min-w-0 shrink items-center gap-1" data-testid="grid-tile-controls" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-label={t('common.close')}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  >
                    <X className="icon-status" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('common.close')}</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <AppShellProvider value={contextOverride}>
              <NavigationContext.Provider value={panelNavigation}>
                <ShellSidebarContext.Provider value={ownsSidebar ? sidebarTarget : null}>
                 <BarePanelContext.Provider value={barePanel}>
                  <WorkspaceToolContext.Provider value={entry.toolContext ?? null}>
                    {hibernated ? (
                      <div className="flex h-full items-center justify-center text-caption text-muted-foreground" data-panel-hibernated="">{t('shell.strip.hibernated')}</div>
                    ) : entry.tool ? <AuxiliaryToolPanel entry={entry} onClose={handleClose} /> : (
                      <MainContentPanel navStateOverride={navState}
                        isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden} panelId={entry.id} />
                    )}
                  </WorkspaceToolContext.Provider>
                 </BarePanelContext.Provider>
                </ShellSidebarContext.Provider>
              </NavigationContext.Provider>
            </AppShellProvider>
          </div>
          {belowContent}
        </div>
      </div>
    </>
  )
}
