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
import {
  PANEL_MIN_WIDTH,
  inlineSashGeometry,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'
import { ResizeHandle, sashHitWidthPx } from './ResizeHandle'
import { usePanelResize } from '@/hooks/usePanelResize'
import { equalSplit } from './resize-math'
import type { ResizeBounds } from './resize-controller'

export { PANEL_MIN_WIDTH }

interface PanelResizeSashProps {
  leftIndex: number
  rightIndex: number
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
): ResizeBounds | null {
  const leftPanel = sash.previousElementSibling as HTMLElement | null
  const rightPanel = sash.nextElementSibling as HTMLElement | null
  if (!leftPanel || !rightPanel) return null
  const sizeA = leftPanel.getBoundingClientRect().width
  const sizeB = rightPanel.getBoundingClientRect().width
  const total = sizeA + sizeB
  return {
    leftId,
    rightId,
    total,
    sizeA,
    minA: PANEL_MIN_WIDTH,
    maxA: Math.max(PANEL_MIN_WIDTH, total - PANEL_MIN_WIDTH),
    minB: PANEL_MIN_WIDTH,
    maxB: Math.max(PANEL_MIN_WIDTH, total - PANEL_MIN_WIDTH),
  }
}

export function PanelResizeSash({
  leftIndex,
  rightIndex,
}: PanelResizeSashProps) {
  const resizePanels = useSetAtom(resizePanelsAtom)
  const panelStack = useAtomValue(panelStackAtom)
  const left = panelStack[leftIndex]
  const right = panelStack[rightIndex]
  const leftId = left?.id ?? `missing-left-${leftIndex}`
  const rightId = right?.id ?? `missing-right-${rightIndex}`
  const [sizeA, setSizeA] = useState(PANEL_MIN_WIDTH)

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

  useEffect(() => {
    resize.neighborChanged(leftId, rightId)
  }, [leftId, rightId, resize.neighborChanged])

  return (
    <ResizeHandle
      labelKey="shell.resize.panels"
      controlsId={`${leftId} ${rightId}`}
      valueNow={sizeA}
      valueMin={PANEL_MIN_WIDTH}
      valueMax={Math.max(PANEL_MIN_WIDTH, sizeA + PANEL_MIN_WIDTH)}
      dragging={resize.dragging}
      disabled={!left || !right}
      data-sash-pair={`${leftId}::${rightId}`}
      className="relative z-panel flex justify-center"
      style={{
        alignSelf: 'stretch',
        ...inlineSashGeometry(sashHitWidthPx()),
        marginTop: -PANEL_STACK_VERTICAL_OVERFLOW,
        marginBottom: -PANEL_STACK_VERTICAL_OVERFLOW,
        height: `calc(100% + ${PANEL_STACK_VERTICAL_OVERFLOW * 2}px)`,
      }}
      onPointerDown={(event) => {
        resize.handlePointerDown(event, boundsFromSash(event.currentTarget, leftId, rightId))
      }}
      onPointerMove={resize.handlePointerMove}
      onPointerUp={resize.handlePointerUp}
      onPointerCancel={resize.handlePointerCancel}
      onLostPointerCapture={resize.handleLostPointerCapture}
      onKeyAdjust={(delta) => {
        const sash = document.querySelector(`[data-sash-pair="${leftId}::${rightId}"]`) as HTMLElement | null
        if (!sash) return
        resize.handleKeyAdjust(delta, boundsFromSash(sash, leftId, rightId))
      }}
      onKeyCommit={resize.handleKeyCommit}
      onKeyCancel={resize.handleKeyCancel}
      onReset={() => {
        const sash = document.querySelector(`[data-sash-pair="${leftId}::${rightId}"]`) as HTMLElement | null
        if (!sash) return
        const bounds = boundsFromSash(sash, leftId, rightId)
        if (!bounds) return
        const equal = equalSplit(bounds.total, bounds.minA, bounds.maxA, bounds.minB, bounds.maxB)
        if (!equal.feasible) return
        resize.handleReset(bounds, equal.sizeA)
      }}
    />
  )
}
