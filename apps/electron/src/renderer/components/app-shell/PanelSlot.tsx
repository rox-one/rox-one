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

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { X, ChevronLeft } from 'lucide-react'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { closePanelAtom, focusedPanelIdAtom, primaryPanelIdAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { useAppShellContext, AppShellProvider } from '@/context/AppShellContext'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { MainContentPanel } from './MainContentPanel'
import { PANEL_MIN_WIDTH } from './panel-constants'
import { NavigationContext } from '@/contexts/NavigationContext'
import { useContext } from 'react'
import { ShellSidebarContext } from './ShellSidebarPortal'
import { AuxiliaryToolPanel } from './AuxiliaryToolPanel'
import { WorkspaceToolContext } from '@/atoms/workspace-context'

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
  /** Compact (mobile) mode — shows back button in panel header */
  isCompact?: boolean
}

export function PanelSlot({
  entry,
  isOnly,
  isFocusedPanel,
  isSidebarAndNavigatorHidden,
  proportion,
  sash,
  isCompact,
}: PanelSlotProps) {
  const { t } = useTranslation()
  const closePanel = useSetAtom(closePanelAtom)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const parentContext = useAppShellContext()
  const navigation = useContext(NavigationContext)
  const sidebarTarget = useContext(ShellSidebarContext)
  const primaryId = useAtomValue(primaryPanelIdAtom)
  const navState = parseRouteToNavigationState(entry.route)

  const handleClose = useCallback(() => {
    closePanel(entry.id)
  }, [closePanel, entry.id])

  // Build close button for PanelHeader (via context override)
  const closeButton = useMemo(() => {
    return (
      <PanelHeaderCenterButton
        icon={<X className="h-4 w-4" />}
        onClick={handleClose}
        tooltip={t("common.close")}
      />
    )
  }, [handleClose])

  // Build back button for compact mode — closes the panel to reveal the session list.
  // Same PanelHeaderCenterButton style as X and share, just on the left side.
  const backButton = useMemo(() => {
    if (!isCompact) return undefined
    return (
      <PanelHeaderCenterButton
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={handleClose}
        tooltip={t("common.backToList")}
      />
    )
  }, [isCompact, handleClose])

  // Override AppShellContext so ChatPage/PanelHeader gets our per-panel close button,
  // back button (compact mode), and isFocusedPanel for input field appearance
  const contextOverride = useMemo(() => ({
    ...parentContext,
    rightSidebarButton: closeButton,
    leadingAction: backButton,
    isFocusedPanel,
    panelId: entry.id,
  }), [parentContext, closeButton, backButton, isFocusedPanel, entry.id])
  const panelNavigation = navigation && navState ? { ...navigation, navigationState: navState } : navigation

  const handlePointerDown = useCallback(() => {
    if (!isFocusedPanel) {
      setFocusedPanel(entry.id)
    }
  }, [isFocusedPanel, setFocusedPanel, entry.id])

  return (
    <>
      {sash}
      <div
        onPointerDown={handlePointerDown}
        onFocusCapture={() => {
          if (!isFocusedPanel) setFocusedPanel(entry.id)
        }}
        data-panel-role="content"
        data-panel-id={entry.id}
        data-shell-role="content"
        data-compact={isCompact || undefined}
        data-auxiliary-tool={entry.tool}
        tabIndex={-1}
        className={cn(
          'h-full overflow-hidden relative @container/panel',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
          // One-surface shell: flush pane on the shared background. Split view
          // keeps a hairline between panels and a thin focus accent (no boxes).
          'rox-shell-pane',
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
            : { flexGrow: entry.tool ? 0 : proportion, flexShrink: entry.tool ? 0 : 1,
                flexBasis: entry.tool ? 360 : 0, minWidth: entry.tool ? 300 : PANEL_MIN_WIDTH }
          ),
        }}
      >
        <div className="h-full flex flex-col">
          <AppShellProvider value={contextOverride}>
            <NavigationContext.Provider value={panelNavigation}>
              <ShellSidebarContext.Provider value={entry.tool || (primaryId && primaryId !== entry.id) ? null : sidebarTarget}>
                <WorkspaceToolContext.Provider value={entry.toolContext ?? null}>
                {entry.tool ? <AuxiliaryToolPanel entry={entry} onClose={handleClose} /> : (
                  <MainContentPanel navStateOverride={navState}
                    isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden} panelId={entry.id} />
                )}
                </WorkspaceToolContext.Provider>
              </ShellSidebarContext.Provider>
            </NavigationContext.Provider>
          </AppShellProvider>
        </div>
      </div>
    </>
  )
}
