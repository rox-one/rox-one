/**
 * Headless React helpers for gantt timelines: track measurement and pointer
 * drag (move / resize) with whole-day snapping. Rendering stays with the caller.
 */
import * as React from 'react'
import { dragDeltaDays, type GanttDragMode } from './gantt-engine'

/** Measures an element's width and follows resizes. */
export function useTrackWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.getBoundingClientRect().width)
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [ref])
  return width
}

export interface GanttDragState {
  id: string
  mode: GanttDragMode
  startX: number
  pxPerDay: number
  deltaDays: number
}

export interface UseGanttDragOptions {
  pxPerDay: number
  /** Called on release when the bar moved by at least one day. */
  onCommit: (id: string, mode: GanttDragMode, deltaDays: number) => void
  /** Called on release without movement (a click). */
  onClick?: (id: string) => void
}

export function useGanttDrag({ pxPerDay, onCommit, onClick }: UseGanttDragOptions) {
  const [drag, setDrag] = React.useState<GanttDragState | null>(null)
  const onPointerDown = (e: React.PointerEvent, id: string, mode: GanttDragMode) => {
    if (pxPerDay <= 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDrag({ id, mode, startX: e.clientX, pxPerDay, deltaDays: 0 })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const deltaDays = dragDeltaDays(drag.startX, e.clientX, drag.pxPerDay)
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays })
  }
  const onPointerUp = () => {
    if (!drag) return
    const { id, mode, deltaDays } = drag
    setDrag(null)
    if (deltaDays) onCommit(id, mode, deltaDays)
    else onClick?.(id)
  }
  const onPointerCancel = () => setDrag(null)
  return { drag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
}
