/**
 * Issue 09 — Session Canvas layout chrome: align/distribute, guides, magnetic ports.
 */

export type CanvasBox = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'
export type DistributeMode = 'horizontal' | 'vertical'
export type PortSide = 'left' | 'right' | 'top' | 'bottom'
export type CanvasRunStatus = 'idle' | 'running' | 'waiting' | 'error' | 'selected'

export type CanvasGuide = { axis: 'x' | 'y'; value: number }

export const CANVAS_SNAP_THRESHOLD = 8
export const CANVAS_PERF_BUDGET_NODES = 400

export function canvasNodeStatus(input: {
  selected?: boolean
  toolStatus?: 'ok' | 'error' | 'pending' | 'unknown'
  streaming?: boolean
}): CanvasRunStatus {
  if (input.toolStatus === 'error') return 'error'
  if (input.streaming) return 'running'
  if (input.toolStatus === 'pending') return 'waiting'
  if (input.selected) return 'selected'
  return 'idle'
}

export function canvasStatusClass(status: CanvasRunStatus, theme: 'dark' | 'light' = 'dark'): string {
  const tone = theme === 'light' ? 'light' : 'dark'
  return `rox-canvas-node is-${status} theme-${tone}`
}

export function alignBoxes(boxes: readonly CanvasBox[], mode: AlignMode): CanvasBox[] {
  if (boxes.length === 0) return []
  const minX = Math.min(...boxes.map((box) => box.x))
  const maxRight = Math.max(...boxes.map((box) => box.x + box.width))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxBottom = Math.max(...boxes.map((box) => box.y + box.height))
  const centerX = (minX + maxRight) / 2
  const centerY = (minY + maxBottom) / 2
  return boxes.map((box) => {
    switch (mode) {
      case 'left':
        return { ...box, x: minX }
      case 'right':
        return { ...box, x: maxRight - box.width }
      case 'top':
        return { ...box, y: minY }
      case 'bottom':
        return { ...box, y: maxBottom - box.height }
      case 'centerX':
        return { ...box, x: centerX - box.width / 2 }
      case 'centerY':
        return { ...box, y: centerY - box.height / 2 }
    }
  })
}

export function distributeBoxes(boxes: readonly CanvasBox[], mode: DistributeMode): CanvasBox[] {
  if (boxes.length < 3) return boxes.map((box) => ({ ...box }))
  const sorted = [...boxes].sort((a, b) => (mode === 'horizontal' ? a.x - b.x : a.y - b.y))
  const first = sorted[0]!
  const last = sorted.at(-1)!
  if (mode === 'horizontal') {
    const span = last.x - first.x
    const step = span / (sorted.length - 1)
    return sorted.map((box, index) => ({ ...box, x: first.x + step * index }))
  }
  const span = last.y - first.y
  const step = span / (sorted.length - 1)
  return sorted.map((box, index) => ({ ...box, y: first.y + step * index }))
}

export function tileBoxes(
  boxes: readonly CanvasBox[],
  opts: { cols?: number; gap?: number; origin?: { x: number; y: number } } = {},
): CanvasBox[] {
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(boxes.length || 1)))
  const gap = opts.gap ?? 24
  const origin = opts.origin ?? { x: 24, y: 24 }
  const width = Math.max(...boxes.map((box) => box.width), 160)
  const height = Math.max(...boxes.map((box) => box.height), 80)
  return boxes.map((box, index) => ({
    ...box,
    x: origin.x + (index % cols) * (width + gap),
    y: origin.y + Math.floor(index / cols) * (height + gap),
    width,
    height,
  }))
}

export function guidesFromBoxes(boxes: readonly CanvasBox[], activeId?: string): CanvasGuide[] {
  const guides: CanvasGuide[] = []
  for (const box of boxes) {
    if (box.id === activeId) continue
    guides.push(
      { axis: 'x', value: box.x },
      { axis: 'x', value: box.x + box.width / 2 },
      { axis: 'x', value: box.x + box.width },
      { axis: 'y', value: box.y },
      { axis: 'y', value: box.y + box.height / 2 },
      { axis: 'y', value: box.y + box.height },
    )
  }
  return guides
}

export function snapPosition(
  position: { x: number; y: number },
  guides: readonly CanvasGuide[],
  threshold = CANVAS_SNAP_THRESHOLD,
): { x: number; y: number; snapped: CanvasGuide[] } {
  let x = position.x
  let y = position.y
  const snapped: CanvasGuide[] = []
  let bestX = threshold + 1
  let bestY = threshold + 1
  for (const guide of guides) {
    if (guide.axis === 'x') {
      const delta = Math.abs(position.x - guide.value)
      if (delta <= threshold && delta < bestX) {
        bestX = delta
        x = guide.value
        snapped.push(guide)
      }
    } else {
      const delta = Math.abs(position.y - guide.value)
      if (delta <= threshold && delta < bestY) {
        bestY = delta
        y = guide.value
        snapped.push(guide)
      }
    }
  }
  return { x, y, snapped }
}

export function magneticPorts(from: CanvasBox, to: CanvasBox): { fromSide: PortSide; toSide: PortSide } {
  const fromCx = from.x + from.width / 2
  const fromCy = from.y + from.height / 2
  const toCx = to.x + to.width / 2
  const toCy = to.y + to.height / 2
  const dx = toCx - fromCx
  const dy = toCy - fromCy
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' }
  }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' }
}

export function keyboardConnectTarget(
  selectedId: string,
  direction: PortSide,
  boxes: readonly CanvasBox[],
): string | null {
  const selected = boxes.find((box) => box.id === selectedId)
  if (!selected) return null
  const cx = selected.x + selected.width / 2
  const cy = selected.y + selected.height / 2
  const ranked = boxes
    .filter((box) => box.id !== selectedId)
    .map((box) => {
      const bx = box.x + box.width / 2
      const by = box.y + box.height / 2
      const aligned =
        direction === 'left' || direction === 'right'
          ? Math.abs(by - cy)
          : Math.abs(bx - cx)
      const ahead =
        direction === 'right' ? bx - cx
          : direction === 'left' ? cx - bx
            : direction === 'bottom' ? by - cy
              : cy - by
      return { id: box.id, aligned, ahead }
    })
    .filter((item) => item.ahead > 0)
    .sort((a, b) => a.ahead - b.ahead || a.aligned - b.aligned)
  return ranked[0]?.id ?? null
}

export function withinPerformanceBudget(nodeCount: number): boolean {
  return nodeCount <= CANVAS_PERF_BUDGET_NODES
}
