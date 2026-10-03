/**
 * PanelStackContainer
 *
 * Horizontal layout container for ALL panels:
 * Sidebar → Navigator → Content Panel(s) with resize sashes.
 *
 * Content panels use CSS flex-grow with their proportions as weights:
 * - Each panel gets `flex: <proportion> 1 0px` with `min-width: PANEL_MIN_WIDTH`
 * - Flex distributes available space proportionally — panels fill the viewport
 * - When panels hit min-width, overflow-x: auto kicks in naturally
 *
 * Sidebar and Navigator are NOT part of the proportional layout —
 * they have their own fixed/user-resizable widths managed by AppShell.
 * They just reduce the available width for content panels and scroll with everything else.
 *
 * The right sidebar stays OUTSIDE this container.
 *
 * Compact mode (mobile / narrow window):
 * The flex layout is replaced with an absolute-positioned, transform-animated
 * stack — navigator and the focused content panel both stay mounted and slide
 * in/out via CompactPanelTransition. This produces an iOS UINavigationController
 * feel rather than a CSS reflow.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { panelStackAtom, primaryPanelIdAtom, lastAuxiliaryToolAtom, focusedPanelIdAtom, focusedPanelRouteAtom, findPanelInDirection, type PanelSpatialDirection } from '@/atoms/panel-stack'
import { visibleWorkspacePanels } from './auxiliary-layout'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { isDetailNavState } from '@/lib/nav-helpers'
import { PanelSlot } from './PanelSlot'
const SPATIAL_DIRECTION_BY_KEY: Record<string, PanelSpatialDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

interface PanelStackContainerProps {
  sidebarSlot: React.ReactNode
  sidebarWidth: number
  navigatorSlot: React.ReactNode
  navigatorWidth: number
  isSidebarAndNavigatorHidden: boolean
  isRightSidebarVisible?: boolean
  /** Compact mode: single-panel, list/content toggle (mobile or narrow window) */
  isCompact?: boolean
  isResizing?: boolean
}

export function PanelStackContainer({
  sidebarSlot,
  sidebarWidth,
  navigatorSlot,
  navigatorWidth,
  isSidebarAndNavigatorHidden,
  isCompact = false,
}: PanelStackContainerProps) {
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const focusedRoute = useAtomValue(focusedPanelRouteAtom)
  const primaryId = useAtomValue(primaryPanelIdAtom)
  const lastTool = useAtomValue(lastAuxiliaryToolAtom)
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  useEffect(() => {
    const element = layoutRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth))
    observer.observe(element)
    setAvailableWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const contentPanels = panelStack

  // Compact mode: drill-in is "detail focused", not just "session selected".
  // For sessions: a session is selected. For settings: Overview and every
  // subpage are detail surfaces so compact shows Overview on bare settings.
  const focusedNavState = focusedRoute ? parseRouteToNavigationState(focusedRoute) : null
  const isDetailFocused = isDetailNavState(focusedNavState)
  const hasSelectedContent = isCompact && isDetailFocused

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const setFocusedPanel = useSetAtom(focusedPanelIdAtom)
  const hasTools = contentPanels.some(entry => entry.tool)
  const visibleIds = new Set(isCompact
    ? contentPanels.filter(entry => entry.id === focusedPanelId).map(entry => entry.id)
    : visibleWorkspacePanels(contentPanels, Math.max(0, availableWidth - (isSidebarAndNavigatorHidden ? 0 : sidebarWidth + navigatorWidth)), focusedPanelId, lastTool, primaryId))


  const focusPanelInDirection = useCallback((direction: PanelSpatialDirection): boolean => {
    const container = scrollRef.current
    if (!container) return false
    const containerRect = container.getBoundingClientRect()
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-panel-role="content"][data-panel-id]'))
    const bounds = elements.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      const left = Math.max(rect.left, containerRect.left)
      const top = Math.max(rect.top, containerRect.top)
      const right = Math.min(rect.right, containerRect.right)
      const bottom = Math.min(rect.bottom, containerRect.bottom)
      const id = element.dataset.panelId
      return id && right > left && bottom > top ? [{ id, left, top, right, bottom }] : []
    })
    const nextPanelId = findPanelInDirection(focusedPanelId, bounds, direction)
    if (!nextPanelId) return false

    const nextPanel = elements.find((element) => element.dataset.panelId === nextPanelId)
    if (!nextPanel) return false
    setFocusedPanel(nextPanelId)
    nextPanel.focus({ preventScroll: true })
    return true
  }, [focusedPanelId, setFocusedPanel])

  const handleSpatialPanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = SPATIAL_DIRECTION_BY_KEY[event.key]
    if (!direction || !event.altKey || !(event.metaKey || event.ctrlKey) || event.shiftKey
      || event.defaultPrevented || event.nativeEvent.isComposing
      || document.querySelector('[role="dialog"]')) {
      return
    }

    const target = event.target
    if (target instanceof Element && target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="tree"], [data-terminal], .xterm, .monaco-editor, .cm-editor',
    )) {
      return
    }

    if (focusPanelInDirection(direction)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [focusPanelInDirection])

  useEffect(() => {
    return window.electronAPI?.onPanelFocusDirection?.((direction) => {
      focusPanelInDirection(direction)
    })
  }, [focusPanelInDirection])
  const previousFocusedPanelRef = useRef(focusedPanelId)
  useEffect(() => {
    const previousFocusedPanelId = previousFocusedPanelRef.current
    previousFocusedPanelRef.current = focusedPanelId
    if (!previousFocusedPanelId || panelStack.some((panel) => panel.id === previousFocusedPanelId) || !focusedPanelId) return

    const frame = requestAnimationFrame(() => {
      const nextPanel = Array.from(
        scrollRef.current?.querySelectorAll<HTMLElement>('[data-panel-role="content"][data-panel-id]') ?? [],
      ).find((element) => element.dataset.panelId === focusedPanelId)
      nextPanel?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedPanelId, panelStack])

  // Tool switching changes visibility, never mounting/ownership of the main object.
  return <div ref={element => { layoutRef.current = element; scrollRef.current = element }} onKeyDown={handleSpatialPanelKeyDown} className="flex min-w-0 flex-1 flex-col" data-workspace-tool-layout>
      <div hidden={!hasTools} role="tablist" aria-label={t('navigation.openPanels')} className={cn("shrink-0 gap-1 overflow-x-auto border-b border-foreground/5 px-2 py-1", hasTools ? "flex" : "hidden")}>
        {contentPanels.map(entry => <button key={entry.id} type="button" role="tab"
          aria-selected={entry.id === focusedPanelId} onClick={() => setFocusedPanel(entry.id)}
          className={`whitespace-nowrap rounded px-3 py-1 text-xs ${entry.id === focusedPanelId ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>
          {entry.tool ? t(`navigation.tools.${entry.tool}`) : t('navigation.mainSurface')}
        </button>)}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {!isCompact && !isSidebarAndNavigatorHidden && <>
          <div className="h-full shrink-0 overflow-hidden border-r border-foreground/5" style={{ width: sidebarWidth }}>{sidebarSlot}</div>
          {navigatorSlot && <div className="h-full shrink-0 overflow-hidden border-r border-foreground/5" style={{ width: navigatorWidth }}>{navigatorSlot}</div>}
        </>}
        {isCompact && !hasTools && navigatorSlot && <div hidden={hasSelectedContent} className={cn("h-full min-w-0 flex-1", hasSelectedContent && "hidden")}>{navigatorSlot}</div>}
        <div className={cn("min-w-0 flex-1", isCompact && !hasTools && navigatorSlot && !hasSelectedContent ? "hidden" : "flex")}>
          {contentPanels.map(entry => <div key={entry.id} hidden={!visibleIds.has(entry.id)}
            className={cn('h-full min-w-0', visibleIds.has(entry.id) ? 'flex' : 'hidden')}
            style={{ flex: entry.tool && visibleIds.size > 1 ? '0 0 360px' : '1 1 0' }}>
            <PanelSlot entry={entry} isOnly={true} isFocusedPanel={entry.id === focusedPanelId}
              isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden} isAtLeftEdge={!entry.tool}
              isAtRightEdge={true} proportion={entry.proportion} isCompact={isCompact} />
          </div>)}
        </div>
      </div>
    </div>
}
