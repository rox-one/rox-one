import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  capturePanelResizeTracks,
  resizePanelTracks,
  type PanelGridShape,
  type PanelGridTracks,
  type PanelResizeAxis,
} from '@/lib/panel-workspace-layout'
import { usePanelResize } from '@/hooks/usePanelResize'
import { ResizeHandle } from './ResizeHandle'
import { PANEL_GAP, PANEL_GRID_MIN_HEIGHT, PANEL_GRID_MIN_WIDTH } from './panel-constants'
import { equalSplit } from './resize-math'
import type { ResizeBounds } from './resize-controller'

interface PanelGridResizeSashProps {
  axis: PanelResizeAxis
  index: number
  shape: PanelGridShape
  tracks: PanelGridTracks
  panelIds: string[]
  onTracksChange: (shape: PanelGridShape, tracks: PanelGridTracks, commit?: boolean) => void
}

/** A separator occupies a grid line, so its hit area follows clamped CSS tracks. */
export function PanelGridResizeSash({ axis, index, shape, tracks, panelIds, onTracksChange }: PanelGridResizeSashProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const snapshotRef = useRef(tracks)
  const resizeBaseRef = useRef(tracks)
  const minimum = axis === 'x' ? PANEL_GRID_MIN_WIDTH : PANEL_GRID_MIN_HEIGHT
  const hitSize = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 44 : 28
  const [values, setValues] = useState({ now: minimum, max: minimum })
  const inTrack = (position: number, track: number) => axis === 'x'
    ? position % shape.columns === track
    : Math.floor(position / shape.columns) === track
  const firstIds = panelIds.filter((_, position) => inTrack(position, index))
  const secondIds = panelIds.filter((_, position) => inTrack(position, index + 1))
  const firstId = firstIds.join('|')
  const secondId = secondIds.join('|')

  const getMeasurement = useCallback((): { bounds: ResizeBounds; sizes: number[] } | null => {
    const grid = anchorRef.current?.parentElement
    if (!grid) return null
    const computed = getComputedStyle(grid)
    const sizes = (axis === 'x' ? computed.gridTemplateColumns : computed.gridTemplateRows)
      .split(/\s+/).map(Number.parseFloat)
    const sizeA = sizes[index]
    const sizeB = sizes[index + 1]
    if (!Number.isFinite(sizeA) || !Number.isFinite(sizeB)) return null
    const total = sizeA + sizeB
    return { sizes, bounds: {
      leftId: firstId,
      rightId: secondId,
      sizeA,
      sizeB,
      total,
      minA: minimum,
      minB: minimum,
      maxA: Math.max(minimum, total - minimum),
      maxB: Math.max(minimum, total - minimum),
    } }
  }, [axis, index, minimum, firstId, secondId])

  const apply = useCallback((a: number, b: number, commit: boolean) => {
    const snapshot = resizeBaseRef.current
    const key = axis === 'x' ? 'columns' : 'rows'
    onTracksChange(shape, { ...snapshot, [key]: resizePanelTracks(snapshot[key], index, a, b) }, commit)
  }, [axis, index, shape, onTracksChange])

  const resize = usePanelResize({
    onPreview: (a, b) => apply(a, b, false),
    onCommit: (a, b) => apply(a, b, true),
    onCancel: () => onTracksChange(shape, snapshotRef.current, false),
  }, axis)
  const { neighborChanged } = resize

  useEffect(() => {
    neighborChanged(firstId, secondId)
  }, [firstId, secondId, neighborChanged])

  const measure = useCallback(() => {
    const measurement = getMeasurement()
    if (!measurement) return
    const { bounds } = measurement
    setValues((previous) => previous.now === bounds.sizeA && previous.max === bounds.maxA
      ? previous : { now: bounds.sizeA, max: bounds.maxA })
  }, [getMeasurement])

  useLayoutEffect(measure, [measure, tracks])
  useEffect(() => {
    const grid = anchorRef.current?.parentElement
    if (!grid) return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measure])

  const begin = () => {
    const measurement = getMeasurement()
    if (!measurement) return null
    if (!resize.controller.current?.active) {
      snapshotRef.current = tracks
      resizeBaseRef.current = capturePanelResizeTracks(tracks, axis, measurement.sizes)
    }
    return measurement.bounds
  }

  return (
    <>
      <span ref={anchorRef} hidden />
      <ResizeHandle
        orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        labelKey="shell.resize.panels"
        controlsId={[...firstIds, ...secondIds].join(' ')}
        valueNow={values.now}
        valueMin={minimum}
        valueMax={values.max}
        dragging={resize.dragging}
        data-grid-sash={axis}
        data-grid-sash-index={index}
        className="relative z-20"
        style={axis === 'x' ? {
          width: hitSize,
          gridColumn: index + 1,
          gridRow: '1 / -1',
          justifySelf: 'end',
          alignSelf: 'stretch',
          transform: `translateX(calc(50% + ${PANEL_GAP / 2}px))`,
        } : {
          height: hitSize,
          gridColumn: '1 / -1',
          gridRow: index + 1,
          alignSelf: 'end',
          transform: `translateY(calc(50% + ${PANEL_GAP / 2}px))`,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false) return
          // Finish a keyboard gesture before taking the pointer's cancel
          // snapshot; Escape must keep the already committed keyboard size.
          resize.handleKeyCommit()
          resize.handlePointerDown(event, begin())
        }}
        onPointerMove={resize.handlePointerMove}
        onPointerUp={resize.handlePointerUp}
        onPointerCancel={resize.handlePointerCancel}
        onLostPointerCapture={resize.handleLostPointerCapture}
        onKeyAdjust={(delta) => resize.handleKeyAdjust(delta, begin())}
        onKeyCommit={resize.handleKeyCommit}
        onKeyCancel={resize.handleKeyCancel}
        onReset={() => {
          const bounds = begin()
          if (!bounds) return
          const equal = equalSplit(bounds.total, bounds.minA, bounds.maxA, bounds.minB, bounds.maxB)
          if (equal.feasible) resize.handleReset(bounds, equal.sizeA)
        }}
      />
    </>
  )
}
