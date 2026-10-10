/**
 * Persistent workspace for sidebar, navigator and content panels.
 *
 * Content slots are one flat, keyed list in every arrangement. Grid, focus and
 * compact navigation only change placement/visibility; they never reparent a
 * panel, so its draft, scroll position and embedded surface survive.
 */
import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'
import { visibleWorkspacePanels } from './auxiliary-layout'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/lib/render-profile-motion'
import { panelStackAtom, primaryPanelIdAtom, lastAuxiliaryToolAtom, focusedPanelIdAtom, focusedPanelRouteAtom, findPanelInDirection, expandedPanelIdAtom, type PanelSpatialDirection, type PanelStackEntry } from '@/atoms/panel-stack'
import { bottomTerminalOpenAtom, featureLayoutEngineAtom, featurePanelSwapV1Atom } from '@/atoms/unified-shell'
import { panelLayoutGeometryAtom } from '@/atoms/panel-workspace'
import { parseRouteToNavigationStateOrUnavailable } from '../../../shared/route-parser'
import { isDetailNavState } from '@/lib/nav-helpers'
import { compactPanelShowsContent, panelGridFocusTarget, panelGridKey, panelGridShape, reconcilePanelFullScreen, resolvePanelGridTracks, togglePanelFullScreen } from '@/lib/panel-workspace-layout'
import { computeLayout } from '@/lib/layout-engine'
import { useAction } from '@/actions/useAction'
import { useOptionalDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import { usePanelWorkspaceLayout } from '@/hooks/usePanelWorkspaceLayout'
import { isPanelResizeActive } from './resize-activity'
import { PanelSlot } from './PanelSlot'
import { TerminalPanel } from './TerminalPanel'
import { PanelGridResizeSash } from './PanelGridResizeSash'
import { PanelSwapGripButton } from './PanelSeam'
import {
  PANEL_GAP,
  PANEL_EDGE_INSET,
  PANEL_GRID_MIN_HEIGHT,
  PANEL_GRID_MIN_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
  PANEL_STACK_TOP_INSET,
  PANEL_STACK_BOTTOM_INSET,
} from './panel-constants'

const SPATIAL_DIRECTION_BY_KEY: Record<string, PanelSpatialDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** Grid-sash pointer/knob band, matched to PanelGridResizeSash's own hit size. */
const SWAP_GRIP_TRACK_WIDTH = 28

/** Transient state while a panel-swap drag is in flight. */
interface PanelSwapDragState {
  sourceId: string
  targetId: string | null
  pointer: { x: number; y: number } | null
}

/**
 * Trade two panels in the flat stack. Ids key the move, so a caller may hold a
 * snapshot from an earlier render and still land the permutation on the
 * current order. Proportions travel with their panels; the sum is unchanged.
 */
export function swapPanelOrder(
  stack: readonly PanelStackEntry[],
  firstId: string,
  secondId: string,
): PanelStackEntry[] {
  const first = stack.findIndex((entry) => entry.id === firstId)
  const second = stack.findIndex((entry) => entry.id === secondId)
  if (first < 0 || second < 0 || first === second) return stack as PanelStackEntry[]
  const next = [...stack]
  next[first] = stack[second]
  next[second] = stack[first]
  return next
}

/**
 * The neighbour a focused panel trades places with: the next panel in reading
 * order, falling back to the previous one at the end of the stack.
 */
export function resolveSwapNeighborId(
  stack: readonly PanelStackEntry[],
  focusedId: string | null,
): string | null {
  if (!focusedId) return null
  const index = stack.findIndex((entry) => entry.id === focusedId)
  if (index < 0) return null
  return stack[index + 1]?.id ?? stack[index - 1]?.id ?? null
}

const PANEL_TRANSITION = { type: 'tween' as const, duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] }
/** Compact and desktop panes share the same continuous chrome boundary. */
const COMPACT_PANEL_TOP_GAP = 0

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
  const terminalOpen = useAtomValue(bottomTerminalOpenAtom)
  // The terminal cell mounts on every open, so TerminalPanel cannot observe the
  // closed→open edge itself. The launch restore is the mount that happens while
  // the shell is still initialising; every later mount follows a deliberate open.
  const terminalFocusOnOpenRef = useRef(!terminalOpen)
  useEffect(() => {
    if (!terminalOpen) terminalFocusOnOpenRef.current = true
  }, [terminalOpen])
  const setFocusedPanelId = useSetAtom(focusedPanelIdAtom)
  const expandedPanelId = useAtomValue(expandedPanelIdAtom)
  const setExpandedPanelId = useSetAtom(expandedPanelIdAtom)
  const dismissibleLayers = useOptionalDismissibleLayerRegistry()
  const focusedRoute = useAtomValue(focusedPanelRouteAtom)
  const primaryId = useAtomValue(primaryPanelIdAtom)
  const lastTool = useAtomValue(lastAuxiliaryToolAtom)
  const { t } = useTranslation()
  const layoutRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  useEffect(() => {
    const element = layoutRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth))
    observer.observe(element); setAvailableWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  const hasTools = panels.some(entry => entry.tool)
  const visibleIds = isCompact ? [focusedPanelId ?? panels[0]?.id].filter((id): id is string => !!id)
    : visibleWorkspacePanels(panels, Math.max(0, availableWidth - (isSidebarAndNavigatorHidden ? 0 : sidebarWidth + navigatorWidth)), focusedPanelId, lastTool, primaryId)
  const { mode, preset, preferences, setTracks } = usePanelWorkspaceLayout()
  const layoutEngineEnabled = useAtomValue(featureLayoutEngineAtom)
  const reduceMotion = usePrefersReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const previousFocusedPanelRef = useRef(focusedPanelId)
  const lastDomFocusRef = useRef<{ element: Element; panelId: string | null } | null>(null)
  const composingRef = useRef(false)
  const focusedId = panels.some((entry) => entry.id === focusedPanelId) ? focusedPanelId : panels[0]?.id
  const panelIds = useMemo(() => panels.map((entry) => entry.id), [panels])
  // D8: a promoted panel fills the workspace alone; siblings stay mounted but
  // hidden so their draft, scroll and embedded surface survive the return. A
  // closed/stale id reconciles to null and the shared grid comes back.
  const expandedId = reconcilePanelFullScreen(expandedPanelId, panelIds)
  const isExpanded = expandedId !== null
  const displayedId = isExpanded ? expandedId : focusedId
  // «Студия» geometry (featureLayoutEngine, default OFF). The engine only runs
  // for the flat content grid: a promoted panel and the tool-tab list keep
  // their existing shape, and `auto`/flag-OFF fall through to `mode`.
  const engineLayout = useMemo(() => {
    if (!layoutEngineEnabled || preset === 'auto' || isCompact || hasTools) return null
    const columnsWidth = Math.max(0, availableWidth - (isSidebarAndNavigatorHidden ? 0 : sidebarWidth + navigatorWidth))
    return computeLayout(columnsWidth, preset, panels.length)
  }, [layoutEngineEnabled, preset, isCompact, hasTools, availableWidth, isSidebarAndNavigatorHidden, sidebarWidth, navigatorWidth, panels.length])
  // Publish the resolved geometry for the status-bar readout (G4). The engine
  // memo is the single source: when it is null (flag OFF, `auto`, compact or
  // tool tabs) the readout clears. `list` is the navigator column, `surface` is
  // the columns area handed to `computeLayout`.
  const setPanelLayoutGeometry = useSetAtom(panelLayoutGeometryAtom)
  useEffect(() => {
    if (!engineLayout) { setPanelLayoutGeometry(null); return }
    const columnsWidth = Math.max(0, availableWidth - (isSidebarAndNavigatorHidden ? 0 : sidebarWidth + navigatorWidth))
    if (columnsWidth <= 0) { setPanelLayoutGeometry(null); return }
    setPanelLayoutGeometry({
      preset: engineLayout.preset,
      effective: engineLayout.effective,
      listPx: !isSidebarAndNavigatorHidden && navigatorWidth > 0 ? Math.round(navigatorWidth) : null,
      surfacePx: Math.round(columnsWidth),
    })
  }, [engineLayout, availableWidth, isSidebarAndNavigatorHidden, sidebarWidth, navigatorWidth, setPanelLayoutGeometry])
  const singlePanel = isExpanded || (hasTools
    ? visibleIds.length <= 1
    : isCompact || panels.length <= 1 || (engineLayout ? engineLayout.singlePanel : mode === 'focus'))
  const shape = useMemo(() => {
    if (hasTools) return panelGridShape(visibleIds.length, singlePanel ? 'focus' : 'columns')
    return engineLayout
      ? { columns: engineLayout.columns, rows: engineLayout.rows }
      : panelGridShape(panels.length, singlePanel ? 'focus' : mode)
  }, [panels.length, visibleIds.length, hasTools, singlePanel, mode, engineLayout])
  const tracks = useMemo(() => resolvePanelGridTracks(preferences, shape, panels.map((entry) => entry.proportion)), [preferences, shape, panels])
  const gridKey = panelGridKey(shape)
  const panelIdentity = `${preferences.workspaceId}:${panelIds.join(':')}`
  // The rails collapse while a panel is promoted so it truly fills the screen.
  const hasSidebar = !isExpanded && !isCompact && !isSidebarAndNavigatorHidden && sidebarWidth > 0
  const hasNavigator = !isExpanded && !isSidebarAndNavigatorHidden && navigatorWidth > 0
  const expandedNavigator = !hasTools && navigatorExpanded && hasNavigator && !isCompact
  const isLeftEdge = !hasSidebar && !hasNavigator
  const focusedNavState = focusedRoute ? parseRouteToNavigationStateOrUnavailable(focusedRoute) : null
  const hasSelectedContent = isCompact && (hasTools || compactPanelShowsContent(panels.length, hasNavigator, isDetailNavState(focusedNavState)))
  const transition = isResizing || reduceMotion ? { duration: 0 } : PANEL_TRANSITION
  const gridMinWidth = hasTools || singlePanel ? 0 : shape.columns * PANEL_GRID_MIN_WIDTH + (shape.columns - 1) * PANEL_GAP
  const gridMinHeight = hasTools || shape.rows <= 1 ? 0 : shape.rows * PANEL_GRID_MIN_HEIGHT + (shape.rows - 1) * PANEL_GAP

  const focusPanelInDirection = useCallback((direction: PanelSpatialDirection): boolean => {
    if (singlePanel || isPanelResizeActive()) return false
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
    const topologyTarget = panelGridFocusTarget(hasTools ? visibleIds : panelIds, focusedId, shape, direction)
    const nextPanelId = topologyTarget && bounds.some(bound => bound.id === topologyTarget)
      ? topologyTarget : findPanelInDirection(focusedId, bounds, direction)
    if (!nextPanelId) return false

    const nextPanel = elements.find((element) => element.dataset.panelId === nextPanelId)
    if (!nextPanel) return false
    setFocusedPanelId(nextPanelId)
    nextPanel.focus({ preventScroll: true })
    return true
  }, [focusedId, setFocusedPanelId, singlePanel, panelIds, shape, hasTools, visibleIds])

  // Shortcut bindings mirror the spatial key handler for callers that dispatch
  // actions instead of raw key events.
  const canFocus = (direction: PanelSpatialDirection) => !singlePanel && !isPanelResizeActive()
    && panelGridFocusTarget(panelIds, focusedId, shape, direction) !== null

  useAction('panel.focusLeft', () => { focusPanelInDirection('left') }, { enabled: () => canFocus('left') })
  useAction('panel.focusRight', () => { focusPanelInDirection('right') }, { enabled: () => canFocus('right') })
  useAction('panel.focusUp', () => { focusPanelInDirection('up') }, { enabled: () => canFocus('up') })
  useAction('panel.focusDown', () => { focusPanelInDirection('down') }, { enabled: () => canFocus('down') })

  // D8: one action promotes the focused panel to the whole screen and back.
  // Menu entries route through the registry so the hotkey path (none reserved)
  // and the toolbar item share one implementation.
  useAction('panel.toggleFullScreen', () => {
    setExpandedPanelId((current) => togglePanelFullScreen(current, focusedId, panelIds))
  }, { enabled: () => panels.length > 0 })

  // ── G6 wave 2: panel swap (featurePanelSwapV1) ──────────────────────────
  // Order lives in `panelStackAtom` (already persisted and validated on read),
  // so a swap is a permutation, never a new panel: every routing rule that
  // depends on the stack keeps its contract. Focus follows the panel — the
  // focused id is unchanged while its position moves.
  const swapEnabled = useAtomValue(featurePanelSwapV1Atom)
  const setPanelStack = useSetAtom(panelStackAtom)
  const [swapDrag, setSwapDrag] = useState<PanelSwapDragState | null>(null)
  const swapSourceRef = useRef<string | null>(null)
  const swapStartRef = useRef<{ x: number; y: number } | null>(null)
  const swapDragging = swapDrag !== null

  const swapPanels = useCallback((firstId: string, secondId: string) => {
    setPanelStack((current) => swapPanelOrder(current, firstId, secondId))
  }, [setPanelStack])

  const swapFocusedWithNeighbor = useCallback(() => {
    const neighborId = resolveSwapNeighborId(panels, focusedId ?? null)
    if (!focusedId || !neighborId) return
    swapPanels(focusedId, neighborId)
  }, [panels, focusedId, swapPanels])

  // The single shipped binding. `enabled` is the flag gate: with the flag OFF
  // the chord is never claimed, so the legacy shell's keys behave untouched.
  useAction('panel.swap', swapFocusedWithNeighbor, {
    enabled: () => swapEnabled && !isCompact && panels.length > 1,
  })

  const beginSwapDrag = useCallback((sourceId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    swapSourceRef.current = sourceId
    swapStartRef.current = { x: event.clientX, y: event.clientY }
    setSwapDrag({ sourceId, targetId: null, pointer: { x: event.clientX, y: event.clientY } })
  }, [])

  // A swap drag is a window-level gesture: the pointer leaves the grip at once,
  // and the drop target is whatever panel is under it.
  useEffect(() => {
    if (!swapDragging) return
    const resolveTarget = (x: number, y: number): string | null => {
      const element = document.elementFromPoint(x, y)
      const cell = element?.closest<HTMLElement>('[data-panel-role="content"][data-panel-id]')
      if (!cell || cell.closest('[inert], [aria-hidden="true"]')) return null
      const id = cell.dataset.panelId ?? null
      return id && id !== swapSourceRef.current ? id : null
    }
    const handleMove = (event: PointerEvent) => {
      const targetId = resolveTarget(event.clientX, event.clientY)
      setSwapDrag((current) => (current
        ? { ...current, targetId, pointer: { x: event.clientX, y: event.clientY } }
        : current))
    }
    const handleUp = (event: PointerEvent) => {
      const sourceId = swapSourceRef.current
      const start = swapStartRef.current
      const targetId = resolveTarget(event.clientX, event.clientY)
      // A press that never became a drag is a click on the grip, not a swap.
      const moved = !!start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4
      swapSourceRef.current = null
      swapStartRef.current = null
      setSwapDrag(null)
      if (sourceId && targetId && moved) swapPanels(sourceId, targetId)
    }
    const handleCancel = () => { swapSourceRef.current = null; swapStartRef.current = null; setSwapDrag(null) }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  }, [swapDragging, swapPanels])

  const swapGripLabel = t('shell.panel.swap', { defaultValue: 'Поменять панели местами' })
  const swapBlockedLabel = t('shell.panel.swapBlocked', { defaultValue: 'Обмен недоступен: у панели нет соседа' })
  const swapSourceEntry = swapDrag ? panels.find((entry) => entry.id === swapDrag.sourceId) : undefined
  const swapSourceTitle = swapSourceEntry?.tool
    ? t(`navigation.tools.${swapSourceEntry.tool}`)
    : t('navigation.mainSurface')
  const swapWithLabel = t('shell.panel.swapWith', {
    defaultValue: 'Поменять местами с «{{title}}»',
    title: swapSourceTitle,
  })
  const swapTargetIndex = swapDrag?.targetId ? panels.findIndex((entry) => entry.id === swapDrag.targetId) : -1
  // One grip per vertical seam, but only for the flat single-row grid: a
  // wrapped/multi-row or tool-tab layout keeps the keyboard path alone.
  const swapGripsEnabled = swapEnabled && !isCompact && !isExpanded && !hasTools && !singlePanel
    && shape.rows === 1 && panels.length > 1
  const swapGrips = useMemo(() => {
    if (!swapGripsEnabled) return []
    const grips: { key: string; column: number; sourceId: string; neighborId: string | null }[] = []
    for (let index = 0; index < shape.columns - 1; index += 1) {
      const leftId = panelIds[index]
      const rightId = panelIds[index + 1]
      if (!leftId || !rightId) continue
      const sourceId = focusedId === rightId ? rightId : leftId
      grips.push({
        key: `${gridKey}:swap:${index}:${panelIdentity}`,
        column: index,
        sourceId,
        neighborId: sourceId === leftId ? rightId : leftId,
      })
    }
    return grips
  }, [swapGripsEnabled, shape.columns, panelIds, focusedId, gridKey, panelIdentity])

  // The ghost rides the pointer inside the shell's own coordinate box, so a
  // transformed ancestor cannot displace a `fixed` overlay.
  const swapGhostOffset = (() => {
    if (!swapDrag?.pointer || !layoutRef.current) return null
    const rect = layoutRef.current.getBoundingClientRect()
    return { left: swapDrag.pointer.x - rect.left + 14, top: swapDrag.pointer.y - rect.top + 14 }
  })()

  // Escape restores the shared grid. A dismissible layer at a negative
  // priority yields to dialogs/popovers/inputs, which consume Escape first.
  useEffect(() => {
    if (!isExpanded || !dismissibleLayers) return
    return dismissibleLayers.registerLayer({
      id: 'panel-full-screen',
      type: 'custom',
      priority: -10,
      close: () => setExpandedPanelId(null),
    })
  }, [isExpanded, dismissibleLayers, setExpandedPanelId])

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

  // Removal blurs a focused DOM node to body before the new panel is painted.
  // Remember its owner so a close cannot steal focus from unrelated live UI.
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const element = event.target
      const content = element.closest<HTMLElement>('[data-panel-role="content"][data-panel-id]')
      const tab = element.closest<HTMLElement>('[role="tab"][aria-controls]')
      const panelId = content && scrollRef.current?.contains(content)
        ? content.dataset.panelId ?? null : tab?.getAttribute('aria-controls') ?? null
      lastDomFocusRef.current = { element, panelId }
    }
    const beginComposition = () => { composingRef.current = true }
    const endComposition = () => { composingRef.current = false }
    document.addEventListener('focusin', rememberFocus, true)
    document.addEventListener('compositionstart', beginComposition, true)
    document.addEventListener('compositionend', endComposition, true)
    return () => {
      document.removeEventListener('focusin', rememberFocus, true)
      document.removeEventListener('compositionstart', beginComposition, true)
      document.removeEventListener('compositionend', endComposition, true)
    }
  }, [])

  useEffect(() => {
    const previousId = previousFocusedPanelRef.current
    previousFocusedPanelRef.current = focusedPanelId
    if (!previousId || panels.some(panel => panel.id === previousId) || !focusedId) return
    const frame = requestAnimationFrame(() => {
      if (isPanelResizeActive() || composingRef.current || document.querySelector('[role="dialog"]')) return
      const active = document.activeElement
      if (active && active !== document.body && active !== document.documentElement && active.isConnected) return
      const previousOwner = lastDomFocusRef.current
      if (!previousOwner || previousOwner.panelId !== previousId || previousOwner.element.isConnected) return
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-panel-role="content"][data-panel-id]') ?? [])
        .find(element => element.dataset.panelId === focusedId)
      if (!target?.isConnected || target.closest('[inert], [aria-hidden="true"]')) return
      const bounds = target.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedPanelId, focusedId, panels])

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
      ref={layoutRef}
      onKeyDown={handleSpatialPanelKeyDown}
      data-mobile-menu-root="true"
      data-shell-density={isCompact ? 'compact' : 'regular'}
      data-panel-layout={isCompact ? 'compact' : isExpanded ? 'screen' : engineLayout ? engineLayout.effective : mode}
      data-panel-swap-dragging={swapDrag ? 'true' : undefined}
      className="flex-1 min-h-0 min-w-0 flex flex-col relative z-chrome panel-scroll @container/shell"
      style={{
        overflowX: isCompact ? 'hidden' : 'auto',
        overflowY: isCompact ? 'hidden' : 'auto',
        paddingBlock: PANEL_STACK_VERTICAL_OVERFLOW,
        marginBlock: -PANEL_STACK_VERTICAL_OVERFLOW,
        paddingTop: isCompact ? undefined : PANEL_STACK_TOP_INSET,
        paddingBottom: PANEL_STACK_BOTTOM_INSET,
        paddingRight: isCompact ? 0 : PANEL_EDGE_INSET,
        marginRight: isCompact ? 0 : -PANEL_EDGE_INSET,
      }}
    >
      {hasTools && !isExpanded && <div role="tablist" aria-label={t('navigation.openPanels')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1">
        {panels.map(entry => <button key={entry.id} type="button" role="tab" aria-controls={entry.id} aria-selected={entry.id === focusedId}
          onClick={() => setFocusedPanelId(entry.id)} className={`whitespace-nowrap rounded px-3 py-1 text-xs ${entry.id === focusedId ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>
          {entry.tool ? t(`navigation.tools.${entry.tool}`) : t('navigation.mainSurface')}
        </button>)}
      </div>}
      <motion.div
        className="flex min-h-0 flex-1 relative"
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
          className={`h-full relative shrink-0 overflow-hidden rox-shell-pane ${hasSidebar ? 'rox-shell-divider-r' : ''}`}
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
          className={`overflow-hidden shrink-0 z-[2] rox-shell-pane ${hasNavigator ? 'rox-shell-divider-r' : ''}`}
          style={{
            position: isCompact ? 'absolute' : 'relative',
            flexGrow: expandedNavigator ? 1 : 0,
            height: isCompact ? undefined : '100%',
            top: isCompact ? COMPACT_PANEL_TOP_GAP : undefined,
            bottom: isCompact ? 0 : undefined,
            left: isCompact ? 0 : undefined,
            pointerEvents: !hasNavigator || (isCompact && hasSelectedContent) ? 'none' : 'auto',
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
            minWidth: hasTools || isCompact ? 0 : PANEL_GRID_MIN_WIDTH,
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
              gridTemplateColumns: isExpanded ? 'minmax(0, 1fr)' : hasTools ? visibleIds.map(id => panels.find(entry => entry.id === id)?.tool && visibleIds.length > 1 ? '360px' : 'minmax(0, 1fr)').join(' ') : singlePanel ? 'minmax(0, 1fr)' : tracks.columns.map((weight) => `minmax(${PANEL_GRID_MIN_WIDTH}px, ${weight}fr)`).join(' '),
              gridTemplateRows: shape.rows === 1 ? 'minmax(0, 1fr)' : tracks.rows.map((weight) => `minmax(${PANEL_GRID_MIN_HEIGHT}px, ${weight}fr)`).join(' '),
              gap: PANEL_GAP,
              pointerEvents: isCompact && !hasSelectedContent ? 'none' : 'auto',
            }}
          >
            {panels.map((entry, index) => {
              const isFocused = entry.id === displayedId
              const isHidden = isExpanded ? !isFocused : hasTools ? !visibleIds.includes(entry.id) : singlePanel && !isFocused
              const column = isExpanded || singlePanel ? 0 : hasTools ? Math.max(0, visibleIds.indexOf(entry.id)) : index % shape.columns
              // The terminal lives in the first cell of the first column (the only
              // visible cell in focus/compact layouts) and splits it in half.
              const ownsTerminal = terminalOpen && (singlePanel ? isFocused : index === 0)
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
                  belowContent={ownsTerminal ? (
                    <div className="flex min-h-0 shrink-0 flex-col" style={{ flexBasis: '50%' }} data-terminal-cell="true">
                      <TerminalPanel autoFocus={terminalFocusOnOpenRef.current} />
                    </div>
                  ) : undefined}
                  layoutStyle={{
                    gridColumn: column + 1,
                    gridRow: hasTools || singlePanel ? 1 : Math.floor(index / shape.columns) + 1,
                    minWidth: 0,
                    minHeight: 0,
                    width: '100%',
                    position: isHidden ? 'absolute' : 'relative',
                    inset: isHidden ? 0 : undefined,
                  }}
                />
              )
            })}
            {!hasTools && !singlePanel && Array.from({ length: shape.columns - 1 }, (_, index) => (
              <PanelGridResizeSash key={`${gridKey}:x:${index}:${panelIdentity}`} axis="x" index={index} shape={shape} tracks={tracks} panelIds={panelIds} onTracksChange={setTracks} />
            ))}
            {!hasTools && !singlePanel && Array.from({ length: shape.rows - 1 }, (_, index) => (
              <PanelGridResizeSash key={`${gridKey}:y:${index}:${panelIdentity}`} axis="y" index={index} shape={shape} tracks={tracks} panelIds={panelIds} onTracksChange={setTracks} />
            ))}
            {swapGrips.map((grip) => (
              <div
                key={grip.key}
                data-panel-swap-seam={grip.column}
                className="pointer-events-none relative z-sash"
                style={{
                  width: SWAP_GRIP_TRACK_WIDTH,
                  gridColumn: grip.column + 1,
                  gridRow: '1 / -1',
                  justifySelf: 'end',
                  alignSelf: 'stretch',
                  transform: `translateX(calc(50% + ${PANEL_GAP / 2}px))`,
                }}
              >
                <PanelSwapGripButton
                  gripLabel={swapGripLabel}
                  blockedLabel={swapBlockedLabel}
                  disabled={panels.length < 2}
                  active={swapDrag?.sourceId === grip.sourceId}
                  onDragStart={(event) => beginSwapDrag(grip.sourceId, event)}
                  onActivate={() => { if (grip.neighborId) swapPanels(grip.sourceId, grip.neighborId) }}
                />
              </div>
            ))}
            {swapEnabled && swapDrag?.targetId && swapTargetIndex >= 0 && !isExpanded && !hasTools && !singlePanel ? (
              <div
                key={`${panelIdentity}:swap-target`}
                data-panel-swap-target={swapDrag.targetId}
                className="pointer-events-none relative z-popover rounded-[var(--radius-card)] border-2 border-accent bg-accent/5"
                style={{
                  gridColumn: (swapTargetIndex % shape.columns) + 1,
                  gridRow: Math.floor(swapTargetIndex / shape.columns) + 1,
                }}
              >
                <span className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-card)] border border-accent bg-surface-elevated px-2.5 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-popover)]">
                  <ArrowLeftRight className="icon-caption text-accent" />
                  {swapWithLabel}
                </span>
              </div>
            ) : null}
          </motion.div>
        </div>
        {resizeHandles && !isExpanded && resizeHandles}
      </motion.div>
      {swapEnabled && swapGhostOffset ? (
        <div
          data-panel-swap-ghost="true"
          data-panel-swap-ghost-target={swapDrag?.targetId ?? 'none'}
          className="pointer-events-none absolute z-scrim flex items-center gap-1.5 rounded-[var(--radius-card)] border border-border-subtle bg-surface-elevated px-2 py-1 text-small font-medium text-text-primary shadow-[var(--shadow-overlay)]"
          style={swapGhostOffset}
        >
          <ArrowLeftRight className="icon-caption text-accent" />
          {swapSourceTitle}
        </div>
      ) : null}
    </div>
  )
}
