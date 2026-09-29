import * as React from 'react'
import {
  flattenKanbanColumnTasks,
  kanbanColumnWindow,
  listOffsetInScrollParent,
  KANBAN_COLUMN_OVERSCAN,
} from './kanban-virtualization'
import type { KanbanTask } from './types'

export function KanbanVirtualTaskList({
  tasks,
  expandedTaskIds,
  scrollParentRef,
  scrollTop,
  viewportHeight,
  renderTask,
}: {
  tasks: readonly KanbanTask[]
  expandedTaskIds: ReadonlySet<string>
  scrollParentRef: React.RefObject<HTMLDivElement | null>
  scrollTop: number
  viewportHeight: number
  renderTask: (task: KanbanTask) => React.ReactNode
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  // Real tile heights (id → px), fed back into the window math.
  const [measuredHeights, setMeasuredHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map())
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const observedRef = React.useRef(new Map<Element, string>())

  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setMeasuredHeights((previous) => {
        let next: Map<string, number> | null = null
        for (const entry of entries) {
          const id = observedRef.current.get(entry.target)
          if (!id) continue
          const height = Math.ceil(entry.contentRect.height)
          if (height <= 0 || previous.get(id) === height) continue
          next ??= new Map(previous)
          next.set(id, height)
        }
        return next ?? previous
      })
    })
    observerRef.current = observer
    for (const element of observedRef.current.keys()) observer.observe(element)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [])

  // Stable ref callbacks per task id (no observe/unobserve churn per render).
  const refCallbacks = React.useRef(new Map<string, (element: HTMLDivElement | null) => void>())
  const measureRef = React.useCallback((id: string) => {
    let callback = refCallbacks.current.get(id)
    if (!callback) {
      let current: HTMLDivElement | null = null
      callback = (element: HTMLDivElement | null) => {
        if (current && current !== element) {
          observerRef.current?.unobserve(current)
          observedRef.current.delete(current)
        }
        current = element
        if (element) {
          observedRef.current.set(element, id)
          observerRef.current?.observe(element)
        }
      }
      refCallbacks.current.set(id, callback)
    }
    return callback
  }, [])

  const flattened = React.useMemo(
    () => flattenKanbanColumnTasks(tasks, expandedTaskIds, measuredHeights),
    [tasks, expandedTaskIds, measuredHeights],
  )

  React.useLayoutEffect(() => {
    const list = listRef.current
    const parent = scrollParentRef.current
    if (!list || !parent) return
    const next = listOffsetInScrollParent(list, parent)
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [scrollParentRef, scrollTop, viewportHeight, flattened.totalHeight, tasks.length])

  const window = React.useMemo(
    () => kanbanColumnWindow(flattened, listOffsetTop, scrollTop, viewportHeight, KANBAN_COLUMN_OVERSCAN),
    [flattened, listOffsetTop, scrollTop, viewportHeight],
  )
  const visible = flattened.entries.slice(window.startIndex, window.endIndex)

  return (
    <div ref={listRef} className="relative" style={{ height: flattened.totalHeight }}>
      {visible.map((entry) => {
        if (entry.kind !== 'row') return null
        return (
          <div
            key={entry.key}
            className="absolute left-0 right-0"
            style={{ top: entry.offset }}
          >
            {/* Measured: the slot grows with the tile instead of clipping/overlapping. */}
            <div ref={measureRef(entry.item.id)} data-kanban-tile-slot="">
              {renderTask(entry.item)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
