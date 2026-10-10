/**
 * PanelResizeSash
 *
 * Pointer-capture splitter between adjacent content panels (ZS-05).
 * Preview is rAF-coalesced; only commit writes proportions. Neighbor ID
 * changes cancel the operation instead of resizing a new pair.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { panelStackAtom, resizePanelsAtom } from '@/atoms/panel-stack'
import { featureLayoutEngineAtom } from '@/atoms/unified-shell'
import {
  PANEL_MIN_WIDTH,
  CENTER_MIN_WIDTH,
  inlineSashGeometry,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'
import { sashHitWidthPx } from './ResizeHandle'
import { PanelSeam, type PanelSeamSwapGrip, type PanelSwapSide } from './PanelSeam'
import { usePanelResize } from '@/hooks/usePanelResize'
import { equalSplit, SNAP_PERCENTS, type SplitSnap } from './resize-math'
import type { ResizeBounds } from './resize-controller'

export { PANEL_MIN_WIDTH }

/** Wave-2 swap affordance (featurePanelSwapV1Atom). */
export interface PanelResizeSashSwap {
  enabled: boolean
  /** The panel a grip drag sources: the focused panel when it flanks this seam. */
  focusedPanelId?: string | null
  gripLabel: string
  /** Accessible name when the seam has no sibling to trade with. */
  blockedLabel?: string
  disabled?: boolean
  onDragStart?: (panelId: string, event: React.PointerEvent<HTMLButtonElement>) => void
  onActivate?: (panelId: string) => void
}

interface PanelResizeSashProps {
  leftIndex: number
  rightIndex: number
  /** `featurePanelSwapV1Atom` OFF leaves this undefined → resize-only seam. */
  swap?: PanelResizeSashSwap
}

/** Flex grow divides the space left after padding and ordinary seam borders. */
function fixedPanelWidth(panel: Element | null | undefined): number {
  if (!panel) return 0
  const style = getComputedStyle(panel)
  return [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
    .reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0)
}

function boundsFromSash(
  sash: HTMLElement,
  leftId: string,
  rightId: string,
  neighbourMin: number,
  snap: SplitSnap | undefined,
): ResizeBounds | null {
  const leftPanel = sash.previousElementSibling as HTMLElement | null
  const rightPanel = sash.nextElementSibling as HTMLElement | null
  if (!leftPanel || !rightPanel) return null
  const sizeA = leftPanel.getBoundingClientRect().width
  const sizeB = rightPanel.getBoundingClientRect().width
  const total = sizeA + sizeB
  // Derived maximum: neither side may grow past the point where its neighbour
  // falls under its minimum. With the engine OFF this is PANEL_MIN_WIDTH, i.e.
  // exactly the shipped bound.
  const maxA = Math.max(neighbourMin, total - neighbourMin)
  return {
    leftId,
    rightId,
    total,
    sizeA,
    minA: neighbourMin,
    maxA,
    minB: neighbourMin,
    maxB: maxA,
    snap,
  }
}

export function PanelResizeSash({
  leftIndex,
  rightIndex,
  swap,
}: PanelResizeSashProps) {
  const resizePanels = useSetAtom(resizePanelsAtom)
  const panelStack = useAtomValue(panelStackAtom)
  const layoutEngineOn = useAtomValue(featureLayoutEngineAtom)
  const left = panelStack[leftIndex]
  const right = panelStack[rightIndex]
  const leftId = left?.id ?? `missing-left-${leftIndex}`
  const rightId = right?.id ?? `missing-right-${rightIndex}`
  const [sizeA, setSizeA] = useState(PANEL_MIN_WIDTH)
  // Engine OFF keeps the shipped PANEL_MIN_WIDTH bounds and no targets.
  const neighbourMin = layoutEngineOn ? CENTER_MIN_WIDTH : PANEL_MIN_WIDTH
  const snap: SplitSnap | undefined = layoutEngineOn ? { percents: SNAP_PERCENTS } : undefined

  const applyProportions = useCallback((leftPx: number, rightPx: number, combined: number) => {
    const sash = document.querySelector(`[data-sash-pair="${leftId}::${rightId}"]`)
    const fixedLeft = fixedPanelWidth(sash?.previousElementSibling)
    const fixedRight = fixedPanelWidth(sash?.nextElementSibling)
    const total = leftPx + rightPx - fixedLeft - fixedRight
    if (total <= 0) return
    setSizeA(leftPx)
    const leftProportion = Math.max(0, Math.min(1, (leftPx - fixedLeft) / total)) * combined
    resizePanels({
      leftIndex,
      rightIndex,
      leftProportion,
      rightProportion: combined - leftProportion,
    })
  }, [leftIndex, rightIndex, leftId, rightId, resizePanels])

  const combinedProportion = (left?.proportion ?? 0.5) + (right?.proportion ?? 0.5)

  const resize = usePanelResize({
    onPreview: (a, b) => applyProportions(a, b, combinedProportion),
    onCommit: (a, b) => applyProportions(a, b, combinedProportion),
    onCancel: (a, b) => applyProportions(a, b, combinedProportion),
  })

  // Read the live magnetic state the controller keeps during preview/commit;
  // each preview re-renders through applyProportions, so this stays current.
  const snapState = layoutEngineOn ? resize.controller.current?.snapState : undefined

  useEffect(() => {
    resize.neighborChanged(leftId, rightId)
  }, [leftId, rightId, resize.neighborChanged])

  // The grip trades with the neighbour of the panel the user is working in, so
  // a seam drag is predictable: focus a panel (⌥⌘←/→), then pull its seam.
  const swapSide: PanelSwapSide = swap?.focusedPanelId === rightId ? 'right' : 'left'
  const swapPanelId = swapSide === 'right' ? rightId : leftId
  const swapGrip: PanelSeamSwapGrip | undefined = swap?.enabled
    ? {
        sourceSide: swapSide,
        gripLabel: swap.gripLabel,
        blockedLabel: swap.blockedLabel,
        disabled: swap.disabled ?? (!left || !right),
        onDragStart: (event) => swap.onDragStart?.(swapPanelId, event),
        onActivate: () => swap.onActivate?.(swapPanelId),
      }
    : undefined

  return (
    <PanelSeam
      labelKey="shell.resize.panels"
      controlsId={`${leftId} ${rightId}`}
      valueNow={sizeA}
      valueMin={PANEL_MIN_WIDTH}
      valueMax={Math.max(PANEL_MIN_WIDTH, sizeA + PANEL_MIN_WIDTH)}
      dragging={resize.dragging}
      disabled={!left || !right}
      snap={snapState}
      data-sash-pair={`${leftId}::${rightId}`}
      swapGrip={swapGrip}
      className="relative z-sash flex justify-center"
      style={{
        alignSelf: 'stretch',
        ...inlineSashGeometry(sashHitWidthPx()),
        marginTop: -PANEL_STACK_VERTICAL_OVERFLOW,
        marginBottom: -PANEL_STACK_VERTICAL_OVERFLOW,
        height: `calc(100% + ${PANEL_STACK_VERTICAL_OVERFLOW * 2}px)`,
      }}
      onPointerDown={(event) => {
        // `currentTarget` is the inner handle: bounds must come from the seam
        // wrapper (`data-sash-pair`), whose siblings are the two panels.
        const sash = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-sash-pair]')
        resize.handlePointerDown(event, sash ? boundsFromSash(sash, leftId, rightId, neighbourMin, snap) : null)
      }}
      onPointerMove={resize.handlePointerMove}
      onPointerUp={resize.handlePointerUp}
      onPointerCancel={resize.handlePointerCancel}
      onLostPointerCapture={resize.handleLostPointerCapture}
      onKeyAdjust={(delta) => {
        const sash = document.querySelector(`[data-sash-pair="${leftId}::${rightId}"]`) as HTMLElement | null
        if (!sash) return
        resize.handleKeyAdjust(delta, boundsFromSash(sash, leftId, rightId, neighbourMin, snap))
      }}
      onKeyCommit={resize.handleKeyCommit}
      onKeyCancel={resize.handleKeyCancel}
      onReset={() => {
        const sash = document.querySelector(`[data-sash-pair="${leftId}::${rightId}"]`) as HTMLElement | null
        if (!sash) return
        const bounds = boundsFromSash(sash, leftId, rightId, neighbourMin, snap)
        if (!bounds) return
        const equal = equalSplit(bounds.total, bounds.minA, bounds.maxA, bounds.minB, bounds.maxB)
        if (!equal.feasible) return
        resize.handleReset(bounds, equal.sizeA)
      }}
    />
  )
}
