import * as React from 'react'
import { AlertCircle, LoaderCircle, RotateCcw, Waypoints } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@rox/core'
import { buildRuntimeGraph, projectRuntimeEvents, type RuntimeGraph, type RuntimeRunSummary, type TraceCoverage, type RuntimeNode, type CapabilityRef } from '@rox/core/runtime-trace'
import { useRuntimeTrace } from '@/hooks/useRuntimeTrace'
import { RuntimeCanvas, type RuntimeCanvasApi } from './RuntimeCanvas'
import { RuntimeToolbar, type RuntimeMapMode } from './RuntimeToolbar'
import { RuntimeReplayControls } from './RuntimeReplayControls'
import { RuntimeInspector } from './inspector/RuntimeInspector'
import type { ReadRuntimePayload } from './inspector/ContentViewer'
import { layoutRuntimeGraph, nodeMatches, windowRuntimeNodes, type TimelineMode } from './layout/stable-layout'
import { nodeTitle, nodeSubtitle } from './nodes/node-content'
import { safeDisplayText } from './measurements'
import './runtime-map.css'

export interface RuntimeMapDockProps {
  workspaceId: string; sessionId: string; panelId?: string
  onOpenMessage?: (messageId: string, toolUseId?: string) => void; onClose?: () => void
  editor?: React.ReactNode; selectedEventId?: string; onOpenCapability?: (ref: CapabilityRef) => void
  requestedRootRunId?: string; eventRequestId?: number
  focusMessageId?: string; focusToolUseId?: string; focusRequestId?: number; modeRequestId?: number; initialMode?: 'execution' | 'context' | 'editor'
  legacyMessages?: readonly Message[]
}

export function RuntimeMapDock({ workspaceId, sessionId, panelId, legacyMessages, ...props }: RuntimeMapDockProps) {
  const [rootRunId, setRootRunId] = React.useState<string | undefined>(props.requestedRootRunId)
  const [replayCursor, setReplayCursor] = React.useState<number>()
  const trace = useRuntimeTrace({ workspaceId, sessionId, rootRunId, legacyMessages })
  React.useEffect(() => { setRootRunId(props.requestedRootRunId); setReplayCursor(undefined) }, [workspaceId, sessionId, props.requestedRootRunId, props.eventRequestId])
  const graph = React.useMemo(() => replayCursor === undefined ? trace.graph : buildRuntimeGraph(projectRuntimeEvents(trace.events, { ...trace.state.scope, upToSeq: replayCursor })), [trace.graph, trace.events, trace.state.scope, replayCursor])
  const focusToolUseId = props.focusToolUseId || legacyMessages?.find(message => message.id === props.focusMessageId || message.backendMessageId === props.focusMessageId)?.toolUseId
  return <RuntimeMapView key={`${workspaceId}:${sessionId}:${panelId || 'primary'}`} {...props}
    graph={graph} runs={trace.runs} coverage={trace.coverage} loading={trace.loading} error={trace.error ? String(trace.error) : undefined} onReload={trace.refresh}
    scopeKey={`${workspaceId}:${sessionId}:${panelId || 'primary'}`} selectedRootRunId={rootRunId || trace.events[0]?.rootRunId} onRunChange={id => { setRootRunId(id); setReplayCursor(undefined) }}
    readPayload={trace.readPayload} focusToolUseId={focusToolUseId} replayCursor={replayCursor} replayMinimum={trace.events[0]?.seq ?? 0} replayMaximum={trace.events.at(-1)?.seq ?? -1} onReplayCursorChange={setReplayCursor}
  />
}

export interface RuntimeMapViewProps extends Omit<RuntimeMapDockProps, 'workspaceId' | 'sessionId' | 'panelId'> {
  graph: RuntimeGraph; runs: RuntimeRunSummary[]; coverage: TraceCoverage; scopeKey: string
  loading?: boolean; error?: string; onReload?: () => void; readPayload?: ReadRuntimePayload
  selectedRootRunId?: string; onRunChange?: (id: string) => void
  replayCursor?: number; replayMinimum?: number; replayMaximum?: number; onReplayCursorChange?: (cursor: number | undefined) => void
}

/** Render-only surface is also used by the isolated renderer verification harness. */
export function RuntimeMapView({ graph, runs, coverage, scopeKey, loading, error, onReload, readPayload, onOpenMessage, onClose, editor, selectedEventId, eventRequestId, focusMessageId, focusToolUseId, focusRequestId, modeRequestId, initialMode = 'execution', onOpenCapability, selectedRootRunId, onRunChange, replayCursor, replayMinimum = 0, replayMaximum = -1, onReplayCursorChange }: RuntimeMapViewProps) {
  const { t } = useTranslation()
  const [mode, setMode] = React.useState<RuntimeMapMode>(initialMode)
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState('all')
  const [timelineMode, setTimelineMode] = React.useState<TimelineMode>('compact')
  const [selectedId, setSelectedId] = React.useState<string>()
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [following, setFollowing] = React.useState(true)
  const [pending, setPending] = React.useState(0)
  const [page, setPage] = React.useState(-1)
  const canvas = React.useRef<RuntimeCanvasApi>(null)
  const seenSeq = React.useRef(0)
  const focusedMessage = React.useRef<string | undefined>(undefined)
  const focusedExternalEvent = React.useRef<string | undefined>(undefined)
  const maximum = graph.nodes.reduce((value, node) => Math.max(value, node.endSeq), 0)
  const layoutRootRunId = graph.nodes[0]?.event.rootRunId
  const layout = React.useMemo(() => layoutRuntimeGraph(graph, timelineMode), [graph.topologyVersion, timelineMode, scopeKey, selectedRootRunId, layoutRootRunId])
  React.useEffect(() => {
    const difference = Math.max(0, maximum - seenSeq.current)
    if (!following && difference) setPending(previous => previous + difference)
    seenSeq.current = maximum
  }, [maximum, following])
  React.useEffect(() => { setSelectedId(undefined); setCollapsed(new Set()); setPending(0); setPage(-1); seenSeq.current = 0; setFollowing(replayCursor === undefined) }, [selectedRootRunId])
  const matched = React.useMemo(() => graph.nodes.filter(node => nodeMatches(node, query, filter) && (mode !== 'context' || ['context', 'model', 'run', 'memory', 'skill'].includes(node.kind))), [graph.nodes, query, filter, mode])
  const pageCount = Math.max(1, Math.ceil(matched.length / 200))
  const actualPage = page < 0 ? pageCount - 1 : Math.min(page, pageCount - 1)
  const visible = React.useMemo(() => page < 0 ? matched.slice(-200) : windowRuntimeNodes(matched, actualPage), [matched, actualPage, page])
  const selected = graph.nodes.find(node => node.id === selectedId)
  const toggleLane = React.useCallback((agentId: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(agentId)) next.delete(agentId); else next.add(agentId); return next }), [])
  const selectNode = React.useCallback((node: RuntimeNode) => { setSelectedId(node.id); setFollowing(false); if ((node.messageId || node.toolUseId) && onOpenMessage) onOpenMessage(node.messageId ?? '', node.toolUseId) }, [onOpenMessage])
  function selectEvent(id: string) {
    const node = graph.nodes.find(item => item.id === id || item.events.some(event => event.eventId === id))
    if (!node) return false
    setQuery(''); setFilter('all'); setMode('execution')
    setCollapsed(previous => { const next = new Set(previous); next.delete(node.agentId); return next })
    selectNode(node)
    const index = graph.nodes.findIndex(item => item.id === node.id)
    setPage(Math.floor(index / 200))
    requestAnimationFrame(() => canvas.current?.focusNode(node.id))
    return true
  }
  React.useEffect(() => {
    if (!selectedEventId) { focusedExternalEvent.current = undefined; return }
    const requestKey = `${selectedEventId}:${eventRequestId ?? 0}`
    if (focusedExternalEvent.current !== requestKey && selectEvent(selectedEventId)) focusedExternalEvent.current = requestKey
  }, [selectedEventId, eventRequestId, graph.topologyVersion])
  React.useEffect(() => { setMode(initialMode) }, [initialMode, modeRequestId])
  React.useEffect(() => {
    const focusKey = `${focusMessageId}:${focusToolUseId}:${focusRequestId ?? 0}`
    if ((!focusMessageId && !focusToolUseId) || focusedMessage.current === focusKey) return
    const node = graph.nodes.find(item => focusMessageId && (item.messageId === focusMessageId || item.events.some(event => event.messageId === focusMessageId)) || focusToolUseId && item.toolUseId === focusToolUseId)
    if (node) { focusedMessage.current = focusKey; selectEvent(node.id) }
  }, [focusMessageId, focusToolUseId, focusRequestId, graph.topologyVersion])
  function followLatest() { setFollowing(true); setPending(0); setPage(-1); onReplayCursorChange?.(undefined); canvas.current?.focusLatest() }
  function exportMetadata() {
    // Export contains public observation metadata only, no instructions/tool payloads.
    const content = JSON.stringify({ schemaVersion: 1, rootRunId: selectedRootRunId, coverage, nodes: graph.nodes.map(node => ({ id: node.id, kind: node.kind, agentId: node.agentId, status: node.status, seq: node.seq, endSeq: node.endSeq, durationMs: node.durationMs })), edges: graph.edges }, null, 2)
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rox-runtime-trace-metadata.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <section className="runtime-map-dock" data-testid="runtime-map-dock">
    <RuntimeToolbar mode={mode} onModeChange={setMode} editorAvailable={!!editor} runs={runs} selectedRootRunId={selectedRootRunId} onRunChange={onRunChange} query={query} onQueryChange={value => { setQuery(value); setPage(-1) }} filter={filter} onFilterChange={value => { setFilter(value); setPage(-1) }} following={following && replayCursor === undefined} pending={pending} onFollow={followLatest} onFit={() => { setFollowing(false); canvas.current?.fit() }} onClose={onClose} timelineMode={timelineMode} onTimelineModeChange={setTimelineMode} comparableTime={layout.comparableTime} coverage={coverage} onExport={exportMetadata} />
    {error && <div className="runtime-warning runtime-transport-error" role="alert"><AlertCircle size={14} /><span>{t('runtimeMap.connectionError')}</span>{onReload && <button type="button" onClick={onReload}><RotateCcw size={13} />{t('runtimeMap.retry')}</button>}</div>}
    <div className="runtime-map-body">
      {mode === 'editor' ? <div className="runtime-editor-slot">{editor}</div> : loading && !graph.nodes.length ? <div className="runtime-empty"><LoaderCircle size={22} /><p>{t('runtimeMap.loading')}</p></div> : !graph.nodes.length ? <div className="runtime-empty"><Waypoints size={32} /><h3>{t('runtimeMap.emptyTitle')}</h3><p>{t('runtimeMap.emptyDescription')}</p>{coverage.state !== 'complete' && <p className="runtime-muted">{t('runtimeMap.coveragePartial')}</p>}</div> : <>
        <div className="runtime-canvas-column">{mode === 'list' ? <div className="runtime-event-list" role="list" aria-label={t('runtimeMap.mode.list')}>{visible.map(node => <button key={node.id} role="listitem" type="button" data-selected={node.id === selectedId} onClick={() => selectNode(node)}><span>#{node.seq}</span><strong>{nodeTitle(node, t)}</strong><p>{nodeSubtitle(node, t)}</p><small>{safeDisplayText(node.agentId, 80)} · {node.status ? t(`runtimeMap.status.${node.status}`) : t('runtimeMap.unknown')}</small></button>)}</div> : <RuntimeCanvas graph={graph} nodes={visible} layout={layout} scopeKey={scopeKey} selectedId={selectedId} onSelect={selectNode} following={following && replayCursor === undefined} onInspect={() => setFollowing(false)} collapsed={collapsed} onToggleLane={toggleLane} apiRef={canvas} timelineMode={timelineMode} />}
          {!visible.length && <div className="runtime-no-matches">{t('runtimeMap.noMatches')}</div>}
          {pageCount > 1 && <div className="runtime-window-nav"><button type="button" disabled={actualPage === 0} onClick={() => { setPage(actualPage - 1); setFollowing(false) }}>{t('runtimeMap.previousWindow')}</button><span>{page < 0 ? t('runtimeMap.latestWindow', { count: visible.length }) : t('runtimeMap.window', { page: actualPage + 1, count: pageCount })}</span><button type="button" disabled={actualPage >= pageCount - 1} onClick={() => { setPage(actualPage + 1); setFollowing(false) }}>{t('runtimeMap.nextWindow')}</button></div>}
        </div>
        {selected && <RuntimeInspector node={selected} readPayload={readPayload} onClose={() => setSelectedId(undefined)} onOpenMessage={onOpenMessage} onOpenCapability={onOpenCapability} onSelectEvent={selectEvent} />}
      </>}
    </div>
    {mode !== 'editor' && <RuntimeReplayControls minimum={replayMinimum} maximum={replayMaximum} cursor={replayCursor} onChange={cursor => { setFollowing(cursor === undefined); onReplayCursorChange?.(cursor) }} />}
  </section>
}
