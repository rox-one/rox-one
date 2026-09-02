import { createBlockMarkdownSpec, Node, type JSONContent } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import * as React from 'react'

export type RoxColumnsCount = 2 | 3

export interface RoxColumnsAttrs {
  widths: string
}

const MIN_COLUMN_PERCENT = 18
const DEFAULT_WIDTHS: Record<RoxColumnsCount, number[]> = {
  2: [50, 50],
  3: [33.33, 33.33, 33.34],
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2).replace(/\.?0+$/, '')}%`
}

function parseWidthToken(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number.parseFloat(trimmed)
  if (!Number.isFinite(numeric) || numeric <= 0) return null

  if (trimmed.endsWith('%')) return numeric
  if (trimmed.endsWith('fr')) return numeric
  return numeric
}

function equalWidths(count: RoxColumnsCount): number[] {
  return [...DEFAULT_WIDTHS[count]]
}

function normalizeWidths(widths: number[]): number[] {
  if (widths.length === 0) return widths

  const clamped = widths.map(value => Math.max(MIN_COLUMN_PERCENT, value))
  const total = clamped.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return widths

  const scaled = clamped.map(value => (value / total) * 100)
  let roundedTotal = 0
  const rounded = scaled.map((value, index) => {
    if (index === scaled.length - 1) {
      const tail = Math.max(MIN_COLUMN_PERCENT, Math.round((100 - roundedTotal) * 100) / 100)
      return tail
    }

    const next = Math.round(value * 100) / 100
    roundedTotal += next
    return next
  })

  const correction = Math.round((100 - rounded.reduce((sum, value) => sum + value, 0)) * 100) / 100
  if (Math.abs(correction) > 0.001) {
    const lastIndex = rounded.length - 1
    const lastValue = rounded[lastIndex] ?? MIN_COLUMN_PERCENT
    rounded[lastIndex] = Math.max(MIN_COLUMN_PERCENT, Math.round((lastValue + correction) * 100) / 100)
  }

  return rounded
}

function parseWidthsAttr(widths: string | undefined, count: RoxColumnsCount): number[] {
  const tokens = widths?.split(/[\s,]+/).filter(Boolean) ?? []
  if (tokens.length !== count) return equalWidths(count)

  const values = tokens.map(parseWidthToken)
  if (values.some(value => value == null)) return equalWidths(count)
  const numericValues = values as number[]

  const total = numericValues.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return equalWidths(count)

  const percents = numericValues.map(value => (value / total) * 100)
  return normalizeWidths(percents)
}

function serializeWidths(widths: number[]): string {
  return normalizeWidths(widths).map(formatPercent).join(' ')
}

function createColumnContent(): JSONContent {
  return {
    type: 'roxColumn',
    content: [{ type: 'paragraph' }],
  }
}

export function createRoxColumnsContent(count: RoxColumnsCount = 2): JSONContent {
  const widths = equalWidths(count)
  return {
    type: 'roxColumns',
    attrs: { widths: serializeWidths(widths) },
    content: Array.from({ length: count }, () => createColumnContent()),
  }
}

export function insertRoxColumnsContent(
  editor: { chain: () => { focus: () => any; insertContentAt: (pos: number, payload: JSONContent) => any; run: () => any } ; state: { selection: { from: number } } },
  count: RoxColumnsCount = 2,
  insertPos?: number,
): void {
  const targetPos = insertPos ?? editor.state.selection.from
  editor.chain().focus().insertContentAt(targetPos, createRoxColumnsContent(count)).run()
}

const roxColumnsMarkdown = createBlockMarkdownSpec({
  nodeName: 'roxColumns',
  name: 'rox-columns',
  content: 'block',
  defaultAttributes: { widths: serializeWidths(equalWidths(2)) },
  allowedAttributes: ['widths'],
})

const roxColumnMarkdown = createBlockMarkdownSpec({
  nodeName: 'roxColumn',
  name: 'rox-column',
  content: 'block',
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    roxColumns: {
      insertRoxColumns: (count?: RoxColumnsCount) => ReturnType
    }
  }
}

export function buildResizeWidths(current: number[], index: number, deltaX: number, containerWidth: number): number[] {
  const next = [...current]
  const leftStart = next[index] ?? MIN_COLUMN_PERCENT
  const rightStart = next[index + 1] ?? MIN_COLUMN_PERCENT
  const widthSum = leftStart + rightStart
  const deltaPercent = (deltaX / containerWidth) * 100
  const left = Math.max(MIN_COLUMN_PERCENT, Math.min(widthSum - MIN_COLUMN_PERCENT, leftStart + deltaPercent))
  next[index] = left
  next[index + 1] = widthSum - left
  return normalizeWidths(next)
}

export function buildKeyboardResizeWidths(current: number[], index: number, direction: -1 | 1, step = 4): number[] {
  const next = [...current]
  const leftStart = next[index] ?? MIN_COLUMN_PERCENT
  const rightStart = next[index + 1] ?? MIN_COLUMN_PERCENT
  const widthSum = leftStart + rightStart
  const left = Math.max(MIN_COLUMN_PERCENT, Math.min(widthSum - MIN_COLUMN_PERCENT, leftStart + direction * step))
  next[index] = left
  next[index + 1] = widthSum - left
  return normalizeWidths(next)
}

function ColumnsNodeView({
  node,
  updateAttributes,
}: {
  node: { attrs: { widths?: string }; childCount: number }
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const rafIdRef = React.useRef<number | null>(null)
  const pendingWidthsRef = React.useRef<number[] | null>(null)
  const dragStateRef = React.useRef<{
    index: number
    startX: number
    startWidths: number[]
    containerWidth: number
  } | null>(null)
  const count = Math.max(2, Math.min(3, node.childCount)) as RoxColumnsCount
  const widths = React.useMemo(() => parseWidthsAttr(node.attrs.widths, count), [count, node.attrs.widths])

  React.useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  const flushWidths = React.useCallback(() => {
    rafIdRef.current = null
    const next = pendingWidthsRef.current
    pendingWidthsRef.current = null
    if (!next) return
    updateAttributes({ widths: serializeWidths(next) })
  }, [updateAttributes])

  const scheduleWidths = React.useCallback((next: number[]) => {
    pendingWidthsRef.current = next
    if (rafIdRef.current != null) return
    rafIdRef.current = window.requestAnimationFrame(flushWidths)
  }, [flushWidths])

  const beginResize = React.useCallback((index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    const container = containerRef.current
    if (!container) return

    event.preventDefault()
    event.stopPropagation()

    dragStateRef.current = {
      index,
      startX: event.clientX,
      startWidths: [...widths],
      containerWidth: container.getBoundingClientRect().width,
    }

    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      const next = buildResizeWidths(
        drag.startWidths,
        drag.index,
        moveEvent.clientX - drag.startX,
        Math.max(1, drag.containerWidth),
      )
      scheduleWidths(next)
    }

    const endResize = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endResize)
      window.removeEventListener('pointercancel', endResize)
      dragStateRef.current = null
      if (pendingWidthsRef.current) {
        flushWidths()
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endResize)
    window.addEventListener('pointercancel', endResize)
  }, [flushWidths, scheduleWidths, widths])

  const resizeFromKeyboard = React.useCallback((index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    updateAttributes({
      widths: serializeWidths(buildKeyboardResizeWidths(widths, index, event.key === 'ArrowLeft' ? -1 : 1)),
    })
  }, [updateAttributes, widths])

  const cumulative = React.useMemo(() => {
    let total = 0
    return widths.map(value => {
      const start = total
      total += value
      return start
    })
  }, [widths])

  return (
    <NodeViewWrapper
      ref={containerRef}
      className="tiptap-rox-columns"
      data-columns-count={count}
      style={{ gridTemplateColumns: widths.map(value => `${value}%`).join(' ') }}
    >
      <NodeViewContent className="tiptap-rox-columns-grid" />
      {widths.length > 1 && widths.slice(0, -1).map((_value, index) => (
        <button
          key={`rox-columns-handle-${index}`}
          type="button"
          className="tiptap-rox-columns-resize-handle"
          style={{ left: `calc(${cumulative[index + 1]}% - 7px)` }}
          aria-label={`Resize column ${index + 1}`}
          title="Resize column"
          onPointerDown={(event) => beginResize(index, event)}
          onKeyDown={(event) => resizeFromKeyboard(index, event)}
        >
          <span className="tiptap-rox-columns-resize-grip" />
        </button>
      ))}
    </NodeViewWrapper>
  )
}

function ColumnNodeView() {
  return (
    <NodeViewWrapper className="tiptap-rox-column">
      <NodeViewContent className="tiptap-rox-column-content" />
    </NodeViewWrapper>
  )
}

export const RoxColumnsBlock = Node.create({
  name: 'roxColumns',

  group: 'block',
  content: 'roxColumn+',
  isolating: true,
  defining: true,
  selectable: true,

  addAttributes() {
    return {
      widths: {
        default: serializeWidths(equalWidths(2)),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="rox-columns"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'rox-columns' }]
  },

  ...roxColumnsMarkdown,

  addCommands() {
    return {
      insertRoxColumns:
        (count: RoxColumnsCount = 2) =>
        ({ chain, state }) => {
          const targetPos = state.selection.from
          return chain().focus().insertContentAt(targetPos, createRoxColumnsContent(count)).run()
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => <ColumnsNodeView {...props} />)
  },
})

export const RoxColumnBlock = Node.create({
  name: 'roxColumn',

  group: 'block',
  content: 'block+',
  isolating: true,
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="rox-column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'rox-column' }]
  },

  ...roxColumnMarkdown,

  addNodeView() {
    return ReactNodeViewRenderer((props: any) => <ColumnNodeView {...props} />)
  },
})

export function isRoxColumnsNode(value: unknown): value is { type: string; attrs?: RoxColumnsAttrs } {
  return Boolean(value && typeof value === 'object' && (value as { type?: string }).type === 'roxColumns')
}
