import * as React from 'react'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, Handle, Position, getViewportForBounds, type Node, type NodeProps, type ReactFlowInstance, type Viewport } from '@xyflow/react'
import { ChevronDown, ChevronRight, FileText, Circle, CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RuntimeGraph, RuntimeNode } from '@rox/core/runtime-trace'
import { buildRuntimeContextGroups, runtimeRootAgentId, type ContextGroup } from './context-groups'
import type { RuntimeCanvasApi } from './RuntimeCanvas'
import { safePreview, safeDisplayText } from './measurements'

interface GroupData extends Record<string, unknown> {
  group: ContextGroup; collapsed: boolean; limit: number; selectedId?: string; searching: boolean
  onToggle: (id: string) => void; onMore: (id: string) => void; onSelect: (node: RuntimeNode) => void
}
type GroupNode = Node<GroupData, 'contextGroup'>
const ContextGroupCard = React.memo(function ContextGroupCard({ data }: NodeProps<GroupNode>) {
  const { t } = useTranslation()
  const rows = data.group.rows.slice(0, data.limit)
  return <article className="runtime-context-group" data-testid="runtime-context-group" data-context-group={data.group.id}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <header><button type="button" className="nodrag nopan" aria-expanded={!data.collapsed} onClick={() => data.onToggle(data.group.id)}>{data.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<strong>{t(data.group.titleKey)}</strong><span title={t('runtimeMap.contextGroup.rowCount', { count: data.group.rows.length })}>{data.group.rows.length}</span></button></header>
    {!data.collapsed && <div className="runtime-context-group-rows">
      {!rows.length && <p className="runtime-context-group-empty">{t(data.searching ? 'runtimeMap.noMatches' : 'runtimeMap.notRecorded')}</p>}
      {rows.map(row => {
        const Status = row.status === 'succeeded' ? CheckCircle2 : row.status === 'failed' || row.status === 'interrupted' ? XCircle : row.status === 'waiting-approval' || row.status === 'queued' || row.status === 'blocked' ? Clock3 : Circle
        return <button key={row.id} type="button" className="runtime-context-group-row nodrag nopan" data-testid="runtime-context-row" data-source-event-id={row.sourceEventId} data-source-node-id={row.node.id} data-source-agent-id={row.sourceAgentId} data-context-snapshot-id={row.contextSnapshotId} data-selected={data.selectedId === row.node.id} onClick={() => data.onSelect(row.node)}>
          <FileText size={14} /><span><strong>{row.titleKey ? t(row.titleKey) : row.title}</strong>{(row.status || row.summary || row.summaryKey || row.capability?.version) && <small title={row.measurement?.state === 'known' ? safeDisplayText(`${row.summary} · ${t(`runtimeMap.measurementOrigin.${row.measurement.origin}`)} · ${row.measurement.source}`) : undefined}>{row.status ? `${t(`runtimeMap.status.${row.status}`)}${row.summary || row.summaryKey ? ' · ' : ''}` : ''}{row.summaryKey ? t(row.summaryKey) : row.summary}{row.measurement?.state === 'known' ? ` · ${t(`runtimeMap.measurementOrigin.${row.measurement.origin}`)}` : ''}{row.capability?.version ? ` · ${t('runtimeMap.version')}: ${safePreview(row.capability.version, 40)}` : ''}</small>}</span>
          {row.status && <span className="runtime-context-row-status" data-status={row.status} title={t(`runtimeMap.status.${row.status}`)}><Status size={13} /></span>}
        </button>
      })}
      {data.group.rows.length > rows.length && <button type="button" className="runtime-context-group-more nodrag nopan" onClick={() => data.onMore(data.group.id)}>{t('runtimeMap.contextGroup.more', { count: data.group.rows.length - rows.length })}</button>}
    </div>}
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </article>
})
const nodeTypes = { contextGroup: ContextGroupCard }
function savedCamera(key: string): Viewport | undefined {
  try { const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Viewport | null; if (value && [value.x, value.y, value.zoom].every(Number.isFinite) && value.zoom >= .25 && value.zoom <= 1.5) return value } catch { /* Optional view preference. */ }
  return undefined
}

export interface RuntimeContextCanvasProps { graph: RuntimeGraph; scopeKey: string; selectedId?: string; query?: string; onSelect: (node: RuntimeNode) => void; onAgentChange?: () => void; apiRef: React.Ref<RuntimeCanvasApi> }
export function RuntimeContextCanvas(props: RuntimeContextCanvasProps) { return <ReactFlowProvider><ContextCanvasInner {...props} /></ReactFlowProvider> }
function ContextCanvasInner({ graph, scopeKey, selectedId, query = '', onSelect, onAgentChange, apiRef }: RuntimeContextCanvasProps) {
  const { t } = useTranslation()
  const flow = React.useRef<ReactFlowInstance<GroupNode> | null>(null)
  const container = React.useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [limits, setLimits] = React.useState<Record<string, number>>({})
  const rootAgentId = runtimeRootAgentId(graph)
  const [chosenAgentId, setChosenAgentId] = React.useState<string>()
  const selectedAgentId = chosenAgentId && graph.lanes.some(lane => lane.agentId === chosenAgentId) ? chosenAgentId : rootAgentId
  const cameraKey = `rox.runtime-map.camera:${scopeKey}:${selectedAgentId ?? 'unknown'}`
  const initialCamera = React.useMemo(() => savedCamera(cameraKey) ?? { x: 0, y: 0, zoom: 1 }, [cameraKey])
  const data = React.useMemo(() => buildRuntimeContextGroups(graph, selectedAgentId), [graph.nodes, graph.lanes, selectedAgentId])
  const groups = React.useMemo(() => !query.trim() ? data.groups : data.groups.map(group => ({ ...group, rows: group.rows.filter(row => `${t(group.titleKey)} ${row.titleKey ? t(row.titleKey) : row.title ?? ''} ${row.summaryKey ? t(row.summaryKey) : row.summary ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })), [data.groups, query, t])
  const onToggle = React.useCallback((id: string) => setCollapsed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next }), [])
  const onMore = React.useCallback((id: string) => setLimits(previous => ({ ...previous, [id]: (previous[id] ?? 4) + 4 })), [])
  const nodes = React.useMemo<GroupNode[]>(() => {
    const offsets = [12, 12, 12]
    return groups.map(group => {
      const limit = limits[group.id] ?? 4, closed = collapsed.has(group.id), rowCount = Math.min(group.rows.length, limit)
      const height = closed ? 38 : 38 + Math.max(1, rowCount) * 48 + (group.rows.length > limit ? 32 : 0)
      const position = { x: 12 + group.column * 280, y: offsets[group.column]! }
      offsets[group.column] = position.y + height + 20
      return { id: `context-group:${group.id}`, type: 'contextGroup', position, initialWidth: 256, initialHeight: height, handles: [], draggable: false, selectable: false, focusable: false, style: { pointerEvents: 'auto' }, data: { group, collapsed: closed, limit, selectedId, searching: !!query.trim(), onToggle, onMore, onSelect } }
    })
  }, [groups, collapsed, limits, selectedId, onToggle, onMore, onSelect, query])
  const focusNode = (id: string) => {
    const node = nodes.find(group => group.data.group.rows.some(row => row.node.id === id))
    if (node) void flow.current?.setCenter(node.position.x + 128, node.position.y + 100, { zoom: 1 })
  }
  const fit = () => {
    const instance = flow.current, element = container.current
    if (!instance || !element) return
    const bounds = instance.getNodesBounds(nodes.map(node => node.id))
    void instance.setViewport(getViewportForBounds(bounds, element.clientWidth, element.clientHeight, .25, 1, .12))
  }
  React.useImperativeHandle(apiRef, () => ({ fit, focusNode, focusLatest: () => { if (data.snapshotNode) focusNode(data.snapshotNode.id) } }), [nodes, data.snapshotNode?.id])
  return <div ref={container} className="runtime-canvas runtime-context-canvas" data-testid="runtime-context-canvas">
    <div className="runtime-context-agent-picker"><label>{t('runtimeMap.contextGroup.agent')}<select aria-label={t('runtimeMap.contextGroup.agent')} title={selectedAgentId ? safeDisplayText(selectedAgentId) : undefined} value={selectedAgentId ?? ''} onChange={event => { setChosenAgentId(event.target.value); setCollapsed(new Set()); setLimits({}); onAgentChange?.() }}>{!selectedAgentId && <option value="">{t('runtimeMap.notRecorded')}</option>}{graph.lanes.map(lane => <option key={lane.agentId} value={lane.agentId} title={safeDisplayText(lane.agentId)}>{safeDisplayText(lane.agentId)}{lane.name !== lane.agentId ? ` · ${safePreview(lane.name, 80)}` : ''}{lane.agentId === rootAgentId ? ` · ${t('runtimeMap.mainAgent')}` : ''}</option>)}</select></label>{!data.snapshot && <span>{t('runtimeMap.contextGroup.snapshotMissing')}</span>}</div>
    <ReactFlow<GroupNode> key={cameraKey} nodes={nodes} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={.25} maxZoom={1.5} onlyRenderVisibleElements defaultViewport={initialCamera} proOptions={{ hideAttribution: true }} onInit={instance => { flow.current = instance }} onMoveEnd={(_, viewport) => { try { localStorage.setItem(cameraKey, JSON.stringify(viewport)) } catch { /* Optional view preference. */ } }}>
      <Background id={`runtime-context-dots-${scopeKey}`} variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--runtime-dot)" />
    </ReactFlow>
    <div className="runtime-timeline-caption">{t('runtimeMap.contextGroup.caption')}</div>
  </div>
}
