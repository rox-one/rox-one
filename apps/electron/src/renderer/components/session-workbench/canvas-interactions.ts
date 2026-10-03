export type CanvasPoint = { x: number; y: number }
export type CanvasRect = { left: number; top: number; width: number; height: number }

/** Client coordinates must use the canvas bounds, including its sidebar offset. */
export function canvasCenter(rect: CanvasRect): CanvasPoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

export function centeredNodePosition(point: CanvasPoint, size: { width: number; height: number }): CanvasPoint {
  return { x: point.x - size.width / 2, y: point.y - size.height / 2 }
}

type PlacementBox = CanvasPoint & { width: number; height: number }

/** Nearest visible free position for toolbar creation; null means the viewport is full. */
export function nearestFreeNodePosition(
  center: CanvasPoint,
  size: { width: number; height: number },
  occupied: readonly PlacementBox[],
  bounds: PlacementBox,
  gap = 24,
): CanvasPoint | null {
  const maxX = bounds.x + bounds.width - size.width
  const maxY = bounds.y + bounds.height - size.height
  if (maxX < bounds.x || maxY < bounds.y) return null
  const desired = centeredNodePosition(center, size)
  const baseX = Math.max(bounds.x, Math.min(desired.x, maxX))
  const baseY = Math.max(bounds.y, Math.min(desired.y, maxY))
  // Free space changes only when a row crosses an obstacle edge. For each
  // such row, choose the nearest x outside merged blocked intervals.
  const rows = new Set([baseY, bounds.y, maxY])
  for (const box of occupied) {
    rows.add(Math.max(bounds.y, Math.min(box.y - size.height - gap, maxY)))
    rows.add(Math.max(bounds.y, Math.min(box.y + box.height + gap, maxY)))
  }
  let best: CanvasPoint | null = null
  let bestDistance = Infinity
  for (const y of rows) {
    const intervals = occupied
      .filter((box) => y + size.height + gap > box.y && y < box.y + box.height + gap)
      .map((box) => ({ start: box.x - size.width - gap, end: box.x + box.width + gap }))
      .sort((a, b) => a.start - b.start)
    const merged: typeof intervals = []
    for (const interval of intervals) {
      const previous = merged[merged.length - 1]
      if (previous && interval.start < previous.end) previous.end = Math.max(previous.end, interval.end)
      else merged.push({ ...interval })
    }
    const blocked = merged.find((interval) => baseX > interval.start && baseX < interval.end)
    const candidates = blocked ? [blocked.start, blocked.end] : [baseX]
    for (const x of candidates) {
      if (x < bounds.x || x > maxX) continue
      const distance = (x - desired.x) ** 2 + (y - desired.y) ** 2
      if (distance < bestDistance) {
        best = { x, y }
        bestDistance = distance
      }
    }
  }
  return best
}

/** Menus remain inside even a small canvas; long menus scroll rather than overflow. */
export function canvasMenuPosition(
  point: CanvasPoint,
  rect: CanvasRect,
  menu: { width: number; height: number },
  inset = 8,
): { left: number; top: number } {
  const clamp = (value: number, available: number, extent: number) =>
    Math.max(inset, Math.min(value, Math.max(inset, available - extent - inset)))
  return {
    left: clamp(point.x - rect.left, rect.width, menu.width),
    top: clamp(point.y - rect.top, rect.height, menu.height),
  }
}

export function menuFocusIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return (current + 1 + count) % count
  if (key === 'ArrowUp') return (current - 1 + count) % count
  return null
}

export function isCanvasTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
