/**
 * KnowledgeMapGraph — inline static SVG radial graph (no external graph deps).
 *
 * Edges are `<path>`s (straight for membership, curved for links), nodes are
 * focusable `<g tabIndex=0>` groups with a circle + label coloured by area.
 * Pan/zoom use pointer + wheel handlers; the view transform is owned by the
 * parent (`KnowledgeMapPanel`) so its toolbar buttons can drive it. Keyboard:
 * Enter/Space opens the node, arrow keys move selection to the nearest node in
 * that direction.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeMapDto } from '@rox/shared/knowledge/knowledge-map-types'
import type { RadialLayout, RadialNodePosition } from './radial-layout'
import { AREA_COLORS, AREA_LABEL_KEYS, degreeOf } from './knowledge-map-model'

export interface GraphView {
  scale: number
  x: number
  y: number
}

export const IDENTITY_VIEW: GraphView = { scale: 1, x: 0, y: 0 }
export const ZOOM_MIN = 0.35
export const ZOOM_MAX = 4

interface KnowledgeMapGraphProps {
  dto: KnowledgeMapDto
  layout: RadialLayout
  selectedId: string | null
  onSelectNode: (id: string) => void
  onOpenNode: (id: string) => void
  view: GraphView
  onViewChange: (view: GraphView) => void
  compact?: boolean
}

const ARROW_DIRECTIONS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

function truncateLabel(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`
}

export function KnowledgeMapGraph({
  dto,
  layout,
  selectedId,
  onSelectNode,
  onOpenNode,
  view,
  onViewChange,
  compact = false,
}: KnowledgeMapGraphProps) {
  const { t } = useTranslation()
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const dragRef = React.useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const nodeRefs = React.useRef(new Map<string, SVGGElement>())
  const viewRef = React.useRef(view)
  viewRef.current = view

  const ringGap = compact ? 46 : 92
  const labelMax = compact ? 12 : 20
  const margin = compact ? 34 : 64
  const extent = Math.max(1, layout.radius) * ringGap + margin
  const viewBox = `${-extent} ${-extent} ${extent * 2} ${extent * 2}`

  const nodeById = React.useMemo(() => new Map(dto.nodes.map((node) => [node.id, node])), [dto.nodes])

  const px = (position: RadialNodePosition): { x: number; y: number } => ({
    x: position.x * ringGap,
    y: position.y * ringGap,
  })

  const edges = React.useMemo(() => {
    return dto.edges.flatMap((edge, index) => {
      const from = layout.byId.get(edge.source)
      const to = layout.byId.get(edge.target)
      if (!from || !to) return []
      const a = px(from)
      const b = px(to)
      const d =
        edge.kind === 'link'
          ? `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 - (b.y - a.y) * 0.18} ${(a.y + b.y) / 2 + (b.x - a.x) * 0.18} ${b.x} ${b.y}`
          : `M ${a.x} ${a.y} L ${b.x} ${b.y}`
      return [{ key: `${edge.source}->${edge.target}:${index}`, d, kind: edge.kind }]
    })
  }, [dto.edges, layout, ringGap])

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = svgRef.current?.getBoundingClientRect()
    const ratio = rect && rect.width > 0 ? (extent * 2) / rect.width : 1
    onViewChange({
      ...viewRef.current,
      x: drag.originX + (event.clientX - drag.startX) * ratio,
      y: drag.originY + (event.clientY - drag.startY) * ratio,
    })
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    const current = viewRef.current
    const nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current.scale * factor))
    const svgX = -extent + (event.clientX - rect.left) * ((extent * 2) / rect.width)
    const svgY = -extent + (event.clientY - rect.top) * ((extent * 2) / rect.height)
    const graphX = (svgX - current.x) / current.scale
    const graphY = (svgY - current.y) / current.scale
    onViewChange({ scale: nextScale, x: svgX - graphX * nextScale, y: svgY - graphY * nextScale })
  }

  const handleNodeKeyDown = (event: React.KeyboardEvent<SVGGElement>, position: RadialNodePosition) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpenNode(position.id)
      return
    }
    const direction = ARROW_DIRECTIONS[event.key]
    if (!direction || layout.positions.length === 0) return
    event.preventDefault()
    let best: RadialNodePosition | null = null
    let bestScore = 0
    for (const candidate of layout.positions) {
      if (candidate.id === position.id) continue
      const dx = candidate.x - position.x
      const dy = candidate.y - position.y
      const projection = dx * direction[0] + dy * direction[1]
      if (projection <= 0.05) continue
      const perpendicular = Math.abs(-dx * direction[1] + dy * direction[0])
      const score = projection - perpendicular * 2
      if (best === null || score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (best === null) return
    onSelectNode(best.id)
    nodeRefs.current.get(best.id)?.focus()
  }

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      role="application"
      aria-label={dto.rootLabel}
      className="h-full w-full touch-none select-none overflow-hidden text-muted-foreground motion-reduce:transition-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {layout.layers
          .filter((layer) => layer.level > 0)
          .map((layer) => (
            <circle
              key={`ring-${layer.level}`}
              r={layer.level * ringGap}
              style={{ fill: 'none', stroke: 'var(--border)' }}
              strokeWidth={1}
              strokeDasharray="3 5"
              opacity={0.6}
            />
          ))}
        {edges.map((edge) => (
          <path
            key={edge.key}
            d={edge.d}
            fill="none"
            strokeWidth={edge.kind === 'link' ? 1.4 : 1}
            strokeDasharray={edge.kind === 'link' ? undefined : '2 3'}
            style={{ stroke: edge.kind === 'link' ? 'var(--accent)' : 'var(--border)' }}
            opacity={edge.kind === 'link' ? 0.55 : 0.8}
          />
        ))}
        {layout.positions.map((position) => {
          const node = nodeById.get(position.id)
          if (!node) return null
          const point = px(position)
          const selected = position.id === selectedId
          const degree = degreeOf(position.id, dto.edges)
          const radius = node.kind === 'doc' ? 4.5 + Math.min(6, degree * 0.8) : 8
          const color = AREA_COLORS[node.area] ?? AREA_COLORS.root
          // Group nodes carry raw ids (`context`/`memory`/`notes`) in `label`;
          // show the translated area name in the Russian UI, like the tree/legend.
          const label = node.kind === 'area' ? t(AREA_LABEL_KEYS[node.area]) : node.label
          const showLabel = !compact || node.kind !== 'doc' || selected || position.leafCount >= 2
          return (
            <g
              key={position.id}
              ref={(element) => {
                if (element) nodeRefs.current.set(position.id, element)
                else nodeRefs.current.delete(position.id)
              }}
              tabIndex={0}
              role="button"
              aria-label={label}
              aria-pressed={selected}
              className="cursor-pointer outline-none focus-visible:outline-none motion-reduce:transition-none"
              data-node-id={position.id}
              onClick={() => {
                onSelectNode(position.id)
                onOpenNode(position.id)
              }}
              onKeyDown={(event) => handleNodeKeyDown(event, position)}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={radius + 4}
                fill="transparent"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={radius}
                style={{ fill: color, stroke: selected ? 'var(--foreground)' : 'transparent' }}
                strokeWidth={selected ? 2 : 0}
                opacity={selected ? 1 : 0.9}
                className="transition-opacity motion-reduce:transition-none"
              />
              {showLabel && (
                <text
                  x={point.x}
                  y={point.y - radius - 4}
                  textAnchor="middle"
                  fontSize={compact ? 9 : 11}
                  style={{ fill: selected ? 'var(--foreground)' : 'var(--text-muted)' }}
                  className="pointer-events-none"
                >
                  {truncateLabel(label, labelMax)}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

export default KnowledgeMapGraph