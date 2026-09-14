/**
 * Persistent workspace for sidebar, navigator and content panels.
 *
 * Content slots are one flat, keyed list in every arrangement. Grid, focus and
 * compact navigation only change placement/visibility; they never reparent a
 * panel, so its draft, scroll position and embedded surface survive.
 */
import { useRef, useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion, useReducedMotion } from 'motion/react'
import { panelStackAtom, focusedPanelIdAtom, focusedPanelRouteAtom } from '@/atoms/panel-stack'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { isDetailNavState } from '@/lib/nav-helpers'
import { compactPanelShowsContent, panelGridFocusTarget, panelGridKey, panelGridShape, resolvePanelGridTracks, type PanelFocusDirection } from '@/lib/panel-workspace-layout'
import { usePanelWorkspaceLayout } from '@/hooks/usePanelWorkspaceLayout'
import { useAction } from '@/actions/useAction'
import { isPanelResizeActive } from './resize-activity'
import { PanelSlot } from './PanelSlot'
import { PanelGridResizeSash } from './PanelGridResizeSash'
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_GRID_MIN_HEIGHT,
  PANEL_GRID_MIN_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  RADIUS_EDGE,
  RADIUS_INNER,
} from './panel-constants'

const PANEL_TRANSITION = { type: 'tween' as const, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] }
const COMPACT_PANEL_TOP_GAP = 8

interface PanelStackContainerProps {
  sidebarSlot: React.ReactNode
  sidebarWidth: number
  navigatorSlot: React.ReactNode
  navigatorWidth: number
  /** Absolute separators share the panels' coordinate and scroll owner. */
  resizeHandles?: React.ReactNode
  /** Session catalog fills the workspace until there is a real detail target. */
  navigatorExpanded?: boolean
  isSidebarAndNavigatorHidden: boolean
  isRightSidebarVisible?: boolean
  isCompact?: boolean
  isResizing?: boolean
}

export function PanelStackContainer({
  sidebarSlot,
  sidebarWidth,
  navigatorSlot,
  navigatorWidth,
  resizeHandles,
  navigatorExpanded = false,
  isSidebarAndNavigatorHidden,
  isRightSidebarVisible,
  isCompact = false,
  isResizing,
}: PanelStackContainerProps) {
  const panels = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const focusedRoute = useAtomValue(focusedPanelRouteAtom)
  const { mode, preferences, setTracks } = usePanelWorkspaceLayout()
  const reduceMotion = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusedId = panels.some((entry) => entry.id === focusedPanelId) ? focusedPanelId : panels[0]?.id
  const singlePanel = isCompact || mode === 'focus' || panels.length <= 1
  const shape = useMemo(() => panelGridShape(panels.length, singlePanel ? 'focus' : mode), [panels.length, singlePanel, mode])
  const tracks = useMemo(() => resolvePanelGridTracks(preferences, shape, panels.map((entry) => entry.proportion)), [preferences, shape, panels])
  const gridKey = panelGridKey(shape)
  const panelIds = useMemo(() => panels.map((entry) => entry.id), [panels])
  const panelIdentity = `${preferences.workspaceId}:${panelIds.join(':')}`
  const hasSidebar = !isCompact && sidebarWidth > 0
  const hasNavigator = navigatorWidth > 0
  const expandedNavigator = navigatorExpanded && hasNavigator && !isCompact
  const isLeftEdge = !hasSidebar && !hasNavigator
  const focusedNavState = focusedRoute ? parseRouteToNavigationState(focusedRoute) : null
  const hasSelectedContent = isCompact && compactPanelShowsContent(panels.length, hasNavigator, isDetailNavState(focusedNavState))
  const transition = isResizing || reduceMotion ? { duration: 0 } : PANEL_TRANSITION
  const gridMinWidth = singlePanel ? 0 : shape.columns * PANEL_GRID_MIN_WIDTH + (shape.columns - 1) * PANEL_GAP
  const gridMinHeight = shape.rows <= 1 ? 0 : shape.rows * PANEL_GRID_MIN_HEIGHT + (shape.rows - 1) * PANEL_GAP

  const canFocus = (direction: PanelFocusDirection) => !singlePanel && !isPanelResizeActive()
    && panelGridFocusTarget(panelIds, focusedId, shape, direction) !== null
  const focusDirection = (direction: PanelFocusDirection) => {
    const nextId = panelGridFocusTarget(panelIds, focusedId, shape, direction)
    if (!nextId) return
    setFocusedPanelId(nextId)
    requestAnimationFrame(() => {
      const panel = document.getElementById(nextId)
      if (panel && scrollRef.current?.contains(panel) && !panel.inert) panel.focus({ preventScroll: true })
    })
  }
  useAction('panel.focusLeft', () => focusDirection('left'), { enabled: () => canFocus('left') })
  useAction('panel.focusRight', () => focusDirection('right'), { enabled: () => canFocus('right') })
  useAction('panel.focusUp', () => focusDirection('up'), { enabled: () => canFocus('up') })
  useAction('panel.focusDown', () => focusDirection('down'), { enabled: () => canFocus('down') })

  // Focus via tabs, shortcuts and opening a panel all reveal the actual cell,
  // including the lower rows of a workspace that is smaller than its contents.
  useEffect(() => {
    if (singlePanel || !focusedId) return
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(focusedId)
      if (panel && scrollRef.current?.contains(panel)) {
        panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedId, panels.length, singlePanel, mode, reduceMotion])

  return (
    <div
      data-mobile-menu-root="true"
      data-shell-density={isCompact ? 'compact' : 'regular'}
      data-panel-layout={isCompact ? 'compact' : mode}
      className="flex-1 min-h-0 min-w-0 flex relative z-panel panel-scroll @container/shell"
      style={{
        overflowX: isCompact ? 'hidden' : 'auto',
        overflowY: isCompact ? 'hidden' : 'auto',
        paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
        marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
        marginBottom: -6,
        paddingBottom: 6,
        paddingRight: isCompact ? 0 : 8,
        marginRight: isCompact ? 0 : -8,
      }}
    >
      <motion.div
        className="flex h-full relative"
        initial={false}
        animate={{ paddingLeft: !hasSidebar && !isCompact ? PANEL_EDGE_INSET : 0 }}
        transition={transition}
        style={{ gap: PANEL_GAP, flexGrow: 1, minWidth: 0, minHeight: 0 }}
      >
        <motion.div
          data-panel-role="sidebar"
          initial={false}
          animate={{
            width: hasSidebar ? sidebarWidth : 0,
            marginRight: hasSidebar ? 0 : -PANEL_GAP,
            opacity: hasSidebar ? 1 : 0,
          }}
          transition={transition}
          aria-hidden={!hasSidebar || undefined}
          {...(!hasSidebar ? { inert: '' } : {})}
          className="h-full relative shrink-0"
          style={{ overflowX: 'clip', overflowY: 'visible', display: isCompact ? 'none' : undefined }}
        >
          <div className="h-full" style={{ width: sidebarWidth }}>{sidebarSlot}</div>
        </motion.div>

        <motion.div
          data-panel-role="navigator"
          data-navigator-expanded={expandedNavigator || undefined}
          initial={false}
          animate={{
            width: isCompact ? '100%' : expandedNavigator ? 0 : hasNavigator ? navigatorWidth : 0,
            marginRight: isCompact || hasNavigator ? 0 : -PANEL_GAP,
            opacity: hasNavigator ? 1 : 0,
            x: isCompact && hasSelectedContent ? '-30%' : '0%',
          }}
          transition={transition}
          aria-hidden={!hasNavigator || (isCompact && hasSelectedContent) || undefined}
          {...(!hasNavigator || (isCompact && hasSelectedContent) ? { inert: '' } : {})}
          className="overflow-hidden shrink-0 z-[2] bg-background shadow-middle rox-panel"
          style={{
            position: isCompact ? 'absolute' : 'relative',
            flexGrow: expandedNavigator ? 1 : 0,
            height: isCompact ? undefined : '100%',
            top: isCompact ? COMPACT_PANEL_TOP_GAP : undefined,
            bottom: isCompact ? 0 : undefined,
            left: isCompact ? 0 : undefined,
            pointerEvents: !hasNavigator || (isCompact && hasSelectedContent) ? 'none' : 'auto',
            borderTopLeftRadius: RADIUS_INNER,
            borderBottomLeftRadius: isCompact ? 0 : !hasSidebar ? RADIUS_EDGE : RADIUS_INNER,
            borderTopRightRadius: RADIUS_INNER,
            borderBottomRightRadius: isCompact ? 0 : RADIUS_INNER,
          }}
        >
          <div className="h-full" style={{ width: isCompact || expandedNavigator ? '100%' : navigatorWidth }}>{navigatorSlot}</div>
        </motion.div>

        <div
          ref={scrollRef}
          data-panel-grid-viewport="true"
          aria-hidden={expandedNavigator || undefined}
          {...(expandedNavigator ? { inert: '' } : {})}
          className="relative h-full min-h-0 min-w-0 flex-1 overscroll-contain panel-scroll"
          style={{
            overflow: isCompact ? 'hidden' : 'auto',
            display: expandedNavigator ? 'none' : undefined,
            // Preserve a usable content viewport even when saved rail widths
            // exceed this window. The outer shell supplies overflow as fallback.
            minWidth: isCompact ? 0 : PANEL_GRID_MIN_WIDTH,
          }}
        >
          <motion.div
            data-panel-grid={gridKey}
            data-panel-role="workspace"
            initial={false}
            animate={{ x: isCompact && !hasSelectedContent ? '100%' : '0%' }}
            transition={transition}
            aria-hidden={(isCompact && !hasSelectedContent) || undefined}
            {...(isCompact && !hasSelectedContent ? { inert: '' } : {})}
            className="grid flex-1 min-h-0 isolate"
            style={{
              position: isCompact ? 'absolute' : 'relative',
              width: '100%',
              height: isCompact ? undefined : '100%',
              top: isCompact ? COMPACT_PANEL_TOP_GAP : undefined,
              bottom: isCompact ? 0 : undefined,
              left: isCompact ? 0 : undefined,
              zIndex: isCompact ? 10 : undefined,
              minWidth: gridMinWidth,
              minHeight: gridMinHeight,
              gridTemplateColumns: singlePanel ? 'minmax(0, 1fr)' : tracks.columns.map((weight) => `minmax(${PANEL_GRID_MIN_WIDTH}px, ${weight}fr)`).join(' '),
              gridTemplateRows: shape.rows === 1 ? 'minmax(0, 1fr)' : tracks.rows.map((weight) => `minmax(${PANEL_GRID_MIN_HEIGHT}px, ${weight}fr)`).join(' '),
              gap: PANEL_GAP,
              pointerEvents: isCompact && !hasSelectedContent ? 'none' : 'auto',
            }}
          >
            {panels.map((entry, index) => {
              const isFocused = entry.id === focusedId
              const isHidden = singlePanel && !isFocused
              const column = singlePanel ? 0 : index % shape.columns
              return (
                <PanelSlot
                  key={entry.id}
                  entry={entry}
                  isOnly={singlePanel}
                  isFocusedPanel={isFocused}
                  isHidden={isHidden}
                  isSidebarAndNavigatorHidden={isSidebarAndNavigatorHidden}
                  isAtLeftEdge={column === 0 && isLeftEdge}
                  isAtRightEdge={(singlePanel || column === shape.columns - 1) && !isRightSidebarVisible}
                  proportion={entry.proportion}
                  isCompact={isCompact}
                  layoutStyle={{
                    gridColumn: column + 1,
                    gridRow: singlePanel ? 1 : Math.floor(index / shape.columns) + 1,
                    minWidth: 0,
                    minHeight: 0,
                    width: '100%',
                    position: isHidden ? 'absolute' : 'relative',
                    inset: isHidden ? 0 : undefined,
                  }}
                />
              )
            })}
            {!singlePanel && Array.from({ length: shape.columns - 1 }, (_, index) => (
              <PanelGridResizeSash key={`${gridKey}:x:${index}:${panelIdentity}`} axis="x" index={index} shape={shape} tracks={tracks} panelIds={panelIds} onTracksChange={setTracks} />
            ))}
            {!singlePanel && Array.from({ length: shape.rows - 1 }, (_, index) => (
              <PanelGridResizeSash key={`${gridKey}:y:${index}:${panelIdentity}`} axis="y" index={index} shape={shape} tracks={tracks} panelIds={panelIds} onTracksChange={setTracks} />
            ))}
          </motion.div>
        </div>
        {resizeHandles}
      </motion.div>
    </div>
  )
}
