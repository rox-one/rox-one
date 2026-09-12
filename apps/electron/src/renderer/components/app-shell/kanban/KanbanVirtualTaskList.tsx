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

  const flattened = React.useMemo(
    () => flattenKanbanColumnTasks(tasks, expandedTaskIds),
    [tasks, expandedTaskIds],
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
            style={{ top: entry.offset, height: entry.height }}
          >
            {renderTask(entry.item)}
          </div>
        )
      })}
    </div>
  )
}
