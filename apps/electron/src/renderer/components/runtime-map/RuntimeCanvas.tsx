import * as React from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, getViewportForBounds, type Node, type Edge, type ReactFlowInstance, type Viewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import type { RuntimeGraph, RuntimeNode } from '@rox/core/runtime-trace'
import { RuntimeNodeCard, type RuntimeFlowNode } from './nodes/RuntimeNodeCard'
import { AgentLane, type AgentLaneNode } from './AgentLane'
import { layoutRuntimeGraph, CARD_WIDTH, type RuntimeLayout, type TimelineMode } from './layout/stable-layout'
import { reconcileFlowNodes } from './layout/reconcile-flow-nodes'
import { initialRuntimeCardGeometry, initialRuntimeLaneGeometry } from './layout/initial-geometry'
import { overviewMinimumZoom } from './layout/viewport-policy'

const nodeTypes = { runtime: RuntimeNodeCard, lane: AgentLane }
type FlowNode = RuntimeFlowNode | AgentLaneNode
export interface RuntimeCanvasApi { fit: () => void; focusLatest: () => void; focusNode: (id: string) => void }
export interface RuntimeCanvasProps {
  graph: RuntimeGraph; nodes: RuntimeNode[]; layout: RuntimeLayout; scopeKey: string; selectedId?: string
  onSelect: (node: RuntimeNode) => void; following: boolean; onInspect: () => void
  collapsed: Set<string>; onToggleLane: (agentId: string) => void; apiRef: React.Ref<RuntimeCanvasApi>
  timelineMode: TimelineMode
}

function loadViewport(scopeKey: string): Viewport | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(`rox.runtime-map.camera:${scopeKey}`) || 'null') as Viewport | null
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= 0.001 && saved.zoom <= 1.5) return saved
  } catch { /* Optional camera preference. */ }
  return undefined
}

export function RuntimeCanvas(props: RuntimeCanvasProps) { return <ReactFlowProvider><RuntimeCanvasInner {...props} /></ReactFlowProvider> }
function RuntimeCanvasInner({ graph, nodes, layout, scopeKey, selectedId, onSelect, following, onInspect, collapsed, onToggleLane, apiRef, timelineMode }: RuntimeCanvasProps) {
  const { t } = useTranslation()
  const flow = React.useRef<ReactFlowInstance<FlowNode, Edge> | null>(null)
  const container = React.useRef<HTMLDivElement>(null)
  const nodeCache = React.useRef(new Map<string, FlowNode>())
  const nodeLabelTranslation = React.useRef(t)
  const restoredViewport = React.useMemo(() => loadViewport(scopeKey), [scopeKey])
  const [zoom, setZoom] = React.useState(restoredViewport?.zoom ?? 1)
  const [minimumZoom, setMinimumZoom] = React.useState(Math.min(0.25, restoredViewport?.zoom ?? 0.25))
  const compact = zoom < 0.65
  const visibleIds = React.useMemo(() => new Set(nodes.filter(node => !collapsed.has(node.agentId)).map(node => node.id)), [nodes, collapsed])
  const flowNodes = React.useMemo<FlowNode[]>(() => {
    const candidates: FlowNode[] = [
    ...graph.lanes.map(lane => ({ id: `lane:${lane.id}`, type: 'lane' as const, ...initialRuntimeLaneGeometry, position: layout.lanes.get(lane.id) || { x: -292, y: 44 }, data: { lane, collapsed: collapsed.has(lane.agentId), onToggle: onToggleLane }, draggable: false, selectable: false, focusable: false, style: { width: 250 } })),
    ...nodes.filter(node => visibleIds.has(node.id)).map(node => {
      const cached = nodeCache.current.get(node.id)
      const ariaLabel = cached?.type === 'runtime' && nodeLabelTranslation.current === t && cached.data.runtime.kind === node.kind && cached.data.runtime.seq === node.seq
        ? cached.ariaLabel : t('runtimeMap.eventAria', { type: t(`runtimeMap.kind.${node.kind}`), sequence: node.seq })
      return { id: node.id, type: 'runtime' as const, ...initialRuntimeCardGeometry(compact), position: layout.positions.get(node.id) || { x: 0, y: 44 }, data: { runtime: node }, draggable: false, selectable: true, selected: selectedId === node.id, style: { width: CARD_WIDTH }, ariaLabel }
    }),
    ]
    const reconciled = reconcileFlowNodes(nodeCache.current, candidates)
    nodeCache.current = reconciled.cache
    nodeLabelTranslation.current = t
    return reconciled.nodes
  }, [graph.lanes, layout, nodes, visibleIds, collapsed, onToggleLane, selectedId, t, compact])
  const edges = React.useMemo<Edge[]>(() => graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map(edge => ({ ...edge, type: 'smoothstep', className: `runtime-edge runtime-edge-${edge.kind}`, selectable: false, focusable: false, animated: false })), [graph.edges, visibleIds])
  const latest = nodes.at(-1)
  const cameraInitialized = React.useRef(false)
  const animationDuration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120
  function focusNode(id: string) { const position = layout.positions.get(id); if (position) void flow.current?.setCenter(position.x + CARD_WIDTH / 2, position.y + 86, { zoom: Math.max(1, flow.current.getZoom()), duration: animationDuration() }) }
  function fit() {
    const instance = flow.current, element = container.current
    if (!instance || !element) return
    const ids = visibleIds.size ? [...visibleIds] : graph.lanes.map(lane => `lane:${lane.id}`)
    const bounds = instance.getNodesBounds(ids)
    const minimum = overviewMinimumZoom(bounds, { width: element.clientWidth, height: element.clientHeight })
    setMinimumZoom(minimum)
    // fitView excludes unmeasured offscreen nodes; public bounds include their
    // initial geometry so the whole current window participates in overview.
    const viewport = getViewportForBounds(bounds, element.clientWidth, element.clientHeight, minimum, 1, 0.18)
    void instance.setViewport(viewport, { duration: animationDuration() })
  }
  React.useImperativeHandle(apiRef, () => ({ fit, focusLatest: () => { if (latest) focusNode(latest.id) }, focusNode }), [layout, latest?.id, visibleIds])
  React.useEffect(() => {
    if (following && latest && (!restoredViewport || cameraInitialized.current)) focusNode(latest.id)
    cameraInitialized.current = true
  }, [layout.topologyVersion, following, latest?.id])
  return <div ref={container} className="runtime-canvas" data-semantic-compact={zoom < 0.65} data-testid="runtime-canvas">
    <ReactFlow<FlowNode, Edge>
      nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable
      minZoom={minimumZoom} maxZoom={1.5} onlyRenderVisibleElements panOnScroll
      defaultViewport={restoredViewport} proOptions={{ hideAttribution: true }}
      onInit={instance => { flow.current = instance; if (!restoredViewport && latest && following) focusNode(latest.id) }}
      onNodeClick={(_, node) => { if (node.type === 'runtime') { onInspect(); onSelect(node.data.runtime) } }}
      onSelectionChange={({ nodes: selected }) => { const node = selected.find(item => item.type === 'runtime'); if (node && node.id !== selectedId) { onInspect(); onSelect(node.data.runtime) } }}
      onMoveStart={event => { if (event) onInspect() }}
      onMove={(_, viewport) => setZoom(viewport.zoom)}
      onMoveEnd={(_, viewport) => { try { localStorage.setItem(`rox.runtime-map.camera:${scopeKey}`, JSON.stringify(viewport)) } catch { /* Optional camera preference. */ } }}
    ><Background id={`runtime-dots-${scopeKey}`} variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--runtime-dot)" /></ReactFlow>
    <div className="runtime-timeline-caption">{t(timelineMode === 'time' && layout.comparableTime ? 'runtimeMap.timeCaption' : 'runtimeMap.compactCaption')}</div>
  </div>
}
