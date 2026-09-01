import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  Handle,
  Position,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Brain, Cpu, DatabaseZap, FileText, Trash2, type LucideIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
  StyledContextMenuSub,
  StyledContextMenuSubContent,
  StyledContextMenuSubTrigger,
} from '@/components/ui/styled-context-menu'
import {
  parseSessionMapPin,
  projectSessionScenes,
  serializeSessionMapPin,
  sessionMapPinStorageKey,
  type SceneMessage,
  type SessionMapCamera,
  type SessionMapPin,
} from '@craft-agent/core/mindmap'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SessionFanOutSheet, type FanOutChildJob } from './SessionFanOutSheet'
import { SceneNode } from './SceneNode'
import { toFlowElements, type FlowSceneNode, type SceneNodeData } from './to-flow-elements'
import { holesFromScene } from './holes-from-scene'
import {
  DRAFT_NODE_PROMPTS,
  canPersistDraftEdge,
  createSessionDraftEdge,
  createSessionDraftNode,
  parseSessionDraftGraph,
  serializeSessionDraftGraph,
  sessionDraftNodesStorageKey,
  type SessionDraftGraph,
  type SessionDraftNode,
} from './draft-nodes'
import { deriveSessionNodeKind, SESSION_NODE_KIND_LABELS, type SessionNodeKind } from './node-kinds'

export type RelatedBranch = {
  id: string
  name: string
  fromMessageId?: string
}

export type SessionWorkflowEditorProps = {
  sessionId: string
  messages: SceneMessage[]
  onFork?: (messageId: string) => void
  onRewrite?: (messageId: string, prompt: string) => void
  onCreateChildSessions?: (jobs: FanOutChildJob[]) => void | Promise<void>
  onOpenMessage?: (messageId: string) => void
  relatedBranches?: RelatedBranch[]
  onOpenSession?: (sessionId: string) => void
}

type BranchNodeData = { id: string; name: string; fromMessageId?: string }

function BranchNode({ data }: NodeProps<Node<BranchNodeData, 'branch'>>) {
  return (
    <div
      className="w-[168px] min-w-0 rounded-xl border border-white/10 bg-card/80 px-2.5 py-1.5 text-left shadow-strong backdrop-blur-xl"
      title={data.name}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-border !bg-background/90" />
      <div className="min-w-0 truncate text-xs font-medium leading-4">{data.name}</div>
    </div>
  )
}

type DraftNodeData = {
  draft: SessionDraftNode
  kindLabel: string
  onChangeTitle: (id: string, title: string) => void
  onDelete: (id: string) => void
}

const DRAFT_NODE_ICONS: Record<SessionNodeKind, LucideIcon> = {
  note: FileText,
  model: Cpu,
  tool: DatabaseZap,
  memory: Brain,
}

function DraftNode({ data, selected }: NodeProps<Node<DraftNodeData, 'draft'>>) {
  const Icon = DRAFT_NODE_ICONS[data.draft.kind]
  return (
    <div
      className={cn(
        'group relative w-[224px] min-w-0 overflow-hidden rounded-xl border border-white/10 bg-background/80 p-2 text-left shadow-strong backdrop-blur-xl',
        selected && 'border-violet-400/70 ring-1 ring-violet-400/30',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-border !bg-background/90" />
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {data.kindLabel}
        </span>
        {data.draft.anchorSceneId ? (
          <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            {data.draft.anchorSceneId}
          </span>
        ) : null}
        <button
          type="button"
          className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-foreground/10 hover:text-foreground hover:opacity-100 focus-visible:bg-foreground/10 focus-visible:text-foreground focus-visible:opacity-100"
          aria-label="Delete draft node"
          onClick={(event) => {
            event.stopPropagation()
            data.onDelete(data.draft.id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        className="nodrag nowheel min-h-[64px] w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs leading-4 outline-none placeholder:text-muted-foreground/50 focus:border-violet-400/60"
        value={data.draft.title}
        placeholder={DRAFT_NODE_PROMPTS[data.draft.kind]}
        onChange={(event) => data.onChangeTitle(data.draft.id, event.target.value)}
      />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-border !bg-background/90" />
    </div>
  )
}

const nodeTypes = { scene: SceneNode, branch: BranchNode, draft: DraftNode }

function sceneLabelKind(scene: SceneNodeData['scene']): SessionNodeKind {
  return deriveSessionNodeKind(scene)
}

function loadPin(sessionId: string): SessionMapPin | null {
  try {
    return parseSessionMapPin(localStorage.getItem(sessionMapPinStorageKey(sessionId)), sessionId)
  } catch {
    return null
  }
}

function loadDraftGraph(sessionId: string): SessionDraftGraph {
  try {
    return parseSessionDraftGraph(localStorage.getItem(sessionDraftNodesStorageKey(sessionId)), sessionId)
  } catch {
    return { v: 1, sessionId, nodes: [], edges: [] }
  }
}

function sceneOf(node: Node | undefined): FlowSceneNode['data']['scene'] | null {
  const data = node?.data as FlowSceneNode['data'] | undefined
  return data?.scene ?? null
}

function isDraftFlowNode(node: Node | undefined): node is Node<DraftNodeData, 'draft'> {
  return node?.type === 'draft'
}

function EditorInner({
  sessionId,
  messages,
  onFork,
  onRewrite,
  onCreateChildSessions,
  onOpenMessage,
  relatedBranches = [],
  onOpenSession,
}: SessionWorkflowEditorProps) {
  const { t } = useTranslation()
  const [pin, setPin] = React.useState<SessionMapPin | null>(() => loadPin(sessionId))
  const [draftGraph, setDraftGraph] = React.useState<SessionDraftGraph>(() => loadDraftGraph(sessionId))
  const [camera, setCamera] = React.useState<SessionMapCamera>(() => loadPin(sessionId)?.camera ?? 'map')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedDraftEdgeId, setSelectedDraftEdgeId] = React.useState<string | null>(null)
  const [contextTargetId, setContextTargetId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [fanOutOpen, setFanOutOpen] = React.useState(false)
  const viewportRef = React.useRef<Viewport | undefined>(loadPin(sessionId)?.viewport)
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const flowRef = React.useRef<ReactFlowInstance | null>(null)
  const contextPositionRef = React.useRef<{ x: number; y: number }>({ x: 24, y: 24 })
  const hasContextPositionRef = React.useRef(false)
  const draftNodes = draftGraph.nodes
  const draftEdges = draftGraph.edges

  React.useEffect(() => {
    const next = loadPin(sessionId)
    setPin(next)
    setDraftGraph(loadDraftGraph(sessionId))
    setCamera(next?.camera ?? 'map')
    viewportRef.current = next?.viewport
    setSelectedId(null)
    setSelectedDraftEdgeId(null)
    setContextTargetId(null)
  }, [sessionId])

  React.useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [])

  const graph = React.useMemo(
    () => projectSessionScenes(sessionId, messages),
    [sessionId, messages],
  )

  const { nodes: projected, edges: projectedEdges } = React.useMemo(() => {
    const el = toFlowElements(graph, pin, camera)
    const maxX = el.nodes.reduce((m, n) => Math.max(m, n.position.x), 0)
    const branchNodes: Node<BranchNodeData, 'branch'>[] = relatedBranches.map((b, i) => ({
      id: `br_${b.id}`,
      type: 'branch',
      position: { x: maxX + 280, y: 24 + i * 108 },
      data: { id: b.id, name: b.name, fromMessageId: b.fromMessageId },
    }))
    const branchEdges: typeof el.edges = []
    for (const b of relatedBranches) {
      if (!b.fromMessageId) continue
      const scene = graph.scenes.find((s) => s.triggerMessageId === b.fromMessageId)
      if (!scene) continue
      branchEdges.push({
        id: `e-br-${scene.id}-${b.id}`,
        source: scene.id,
        target: `br_${b.id}`,
        data: { kind: 'fork' },
      })
    }
    return {
      nodes: [...(el.nodes as Node[]), ...branchNodes],
      edges: [...el.edges, ...branchEdges],
    }
  }, [graph, pin, camera, relatedBranches])

  const persistDraftGraph = React.useCallback(
    (next: Pick<SessionDraftGraph, 'nodes' | 'edges'>) => {
      const nextGraph: SessionDraftGraph = { v: 1, sessionId, nodes: next.nodes, edges: next.edges }
      setDraftGraph(nextGraph)
      try {
        localStorage.setItem(sessionDraftNodesStorageKey(sessionId), serializeSessionDraftGraph(sessionId, nextGraph))
      } catch {
        /* ignore quota */
      }
    },
    [sessionId],
  )

  const updateDraftTitle = React.useCallback(
    (id: string, title: string) => {
      persistDraftGraph({
        nodes: draftNodes.map((node) => (node.id === id ? { ...node, title } : node)),
        edges: draftEdges,
      })
    },
    [draftEdges, draftNodes, persistDraftGraph],
  )

  const deleteDraftNode = React.useCallback(
    (id: string) => {
      const nextEdges = draftEdges.filter((edge) => edge.source !== id && edge.target !== id)
      persistDraftGraph({
        nodes: draftNodes.filter((node) => node.id !== id),
        edges: nextEdges,
      })
      if (selectedId === id) setSelectedId(null)
      if (selectedDraftEdgeId && !nextEdges.some((edge) => edge.id === selectedDraftEdgeId)) {
        setSelectedDraftEdgeId(null)
      }
    },
    [draftEdges, draftNodes, persistDraftGraph, selectedDraftEdgeId, selectedId],
  )

  const deleteDraftEdge = React.useCallback(
    (id: string) => {
      persistDraftGraph({
        nodes: draftNodes,
        edges: draftEdges.filter((edge) => edge.id !== id),
      })
      if (selectedDraftEdgeId === id) setSelectedDraftEdgeId(null)
    },
    [draftEdges, draftNodes, persistDraftGraph, selectedDraftEdgeId],
  )

  const labeledProjected = React.useMemo(
    () =>
      projected.map((node) => {
        if (node.type !== 'scene') return node
        const data = node.data as SceneNodeData
        return {
          ...node,
          data: {
            ...data,
            kindLabel: `${SESSION_NODE_KIND_LABELS[data.kind]} inferred`,
          },
        }
      }),
    [projected],
  )

  const draftFlowNodes = React.useMemo<Node<DraftNodeData, 'draft'>[]>(
    () =>
      draftNodes.map((draftNode) => ({
        id: draftNode.id,
        type: 'draft',
        position: draftNode.position,
        data: {
          draft: draftNode,
          kindLabel: SESSION_NODE_KIND_LABELS[draftNode.kind],
          onChangeTitle: updateDraftTitle,
          onDelete: deleteDraftNode,
        },
      })),
    [deleteDraftNode, draftNodes, updateDraftTitle],
  )

  const flowSeedNodes = React.useMemo(
    () => [...labeledProjected, ...draftFlowNodes],
    [draftFlowNodes, labeledProjected],
  )

  const [nodes, setNodes] = React.useState<Node[]>(flowSeedNodes)
  const projectedKey = React.useMemo(
    () =>
      flowSeedNodes
        .map((n) => `${n.id}:${n.position.x}:${n.position.y}:${isDraftFlowNode(n) ? n.data.draft.title : ''}`)
        .join('|') +
      ':' +
      camera +
      ':' +
      sessionId,
    [flowSeedNodes, camera, sessionId],
  )

  React.useEffect(() => {
    setNodes(
      flowSeedNodes.map((n) => ({
        ...n,
        selected: n.id === selectedId,
      })),
    )
    // Keep pin positions; toFlowElements already applied pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection applied via selectedId separately
  }, [projectedKey, graph, pin, camera, flowSeedNodes])

  React.useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === selectedId })))
  }, [selectedId])

  React.useEffect(() => {
    const scene = graph.scenes.find((s) => s.id === selectedId)
    setDraft(scene?.triggerPreview ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-init draft only when selection changes
  }, [selectedId])

  const edges: Edge[] = React.useMemo(
    () => {
      const sceneEdges = projectedEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: e.data,
        style:
          e.data.kind === 'fork'
            ? { stroke: 'rgb(167 139 250)', strokeWidth: 2 }
            : { stroke: 'hsl(var(--border))', strokeWidth: 1.2 },
      }))
      const draftFlowEdges: Edge[] = draftEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { kind: 'draft' },
        selected: edge.id === selectedDraftEdgeId,
        style: { stroke: 'rgb(96 165 250)', strokeWidth: 1.8, strokeDasharray: '5 4' },
      }))
      return [...sceneEdges, ...draftFlowEdges]
    },
    [draftEdges, projectedEdges, selectedDraftEdgeId],
  )

  const persistPin = React.useCallback(
    (next: SessionMapPin) => {
      setPin(next)
      if (persistTimer.current) clearTimeout(persistTimer.current)
      persistTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(sessionMapPinStorageKey(sessionId), serializeSessionMapPin(next))
        } catch {
          /* ignore quota */
        }
      }, 250)
    },
    [sessionId],
  )

  const persistCamera = (nextCamera: SessionMapCamera) => {
    setCamera(nextCamera)
    persistPin({
      v: 1,
      sessionId,
      camera: nextCamera,
      ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
      nodes: pin?.nodes ?? {},
    })
  }

  const onNodesChange = React.useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev))
  }, [])

  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return
      const knownDraftIds = new Set(draftNodes.map((node) => node.id))
      const isDraftOnly = knownDraftIds.has(connection.source) && knownDraftIds.has(connection.target)
      if (!isDraftOnly) {
        toast.message(t('entityView.workbenchForkHint'))
        return
      }
      const next = createSessionDraftEdge({ source: connection.source, target: connection.target })
      if (!canPersistDraftEdge(next, draftNodes, draftEdges)) return
      persistDraftGraph({ nodes: draftNodes, edges: [...draftEdges, next] })
    },
    [draftEdges, draftNodes, persistDraftGraph, t],
  )

  const onConnectEnd = React.useCallback<OnConnectEnd>(
    (_event, state) => {
      if (state.toNode) return
      if (!state.fromNode) return
      if (isDraftFlowNode(state.fromNode as Node | undefined)) return
      const from = sceneOf(state.fromNode as Node | undefined)
      if (from) onFork?.(from.triggerMessageId)
    },
    [onFork],
  )

  const rememberContextPosition = React.useCallback((event: MouseEvent | React.MouseEvent) => {
    const next = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (next) {
      contextPositionRef.current = next
      hasContextPositionRef.current = true
    }
  }, [])

  const rememberTriggerPosition = React.useCallback(
    (event: React.MouseEvent) => {
      rememberContextPosition(event)
    },
    [rememberContextPosition],
  )

  const anchorScene = React.useMemo(() => {
    if (contextTargetId) {
      const target = graph.scenes.find((scene) => scene.id === contextTargetId)
      if (target) return target
    }
    if (selectedId) {
      const selected = graph.scenes.find((scene) => scene.id === selectedId)
      if (selected) return selected
    }
    return graph.scenes[0] ?? null
  }, [contextTargetId, graph.scenes, selectedId])

  const handleCreateNode = React.useCallback(
    (kind: SessionNodeKind) => {
      const position = hasContextPositionRef.current
        ? contextPositionRef.current
        : flowRef.current?.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          }) ?? { x: 24, y: 24 }
      const next = createSessionDraftNode({
        kind,
        position,
        anchorSceneId: anchorScene?.id ?? null,
      })
      persistDraftGraph({ nodes: [...draftNodes, next], edges: draftEdges })
      setSelectedId(next.id)
    },
    [anchorScene?.id, draftEdges, draftNodes, persistDraftGraph],
  )

  const selected = graph.scenes.find((s) => s.id === selectedId) ?? null
  const selectedDraft = draftNodes.find((node) => node.id === selectedId) ?? null

  const resetLayout = () => {
    try {
      localStorage.removeItem(sessionMapPinStorageKey(sessionId))
    } catch {
      /* ignore */
    }
    setPin(null)
    viewportRef.current = undefined
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.2 })
    })
  }

  const selectedKind = selected ? sceneLabelKind(selected) : null
  const selectedKindLabel = selectedKind ? `${SESSION_NODE_KIND_LABELS[selectedKind]} inferred` : ''

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="session-workflow-editor relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
          onContextMenu={rememberTriggerPosition}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.12),transparent_30%)]" />
          <div
            role="toolbar"
            aria-label={t('entityView.map')}
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-w-0 items-center gap-2 px-3 py-1.5 text-[11px]"
          >
            <span className="rounded-full border border-white/10 bg-background/65 px-2 py-1 text-muted-foreground shadow-strong backdrop-blur-xl">
              {t('entityView.flowLive')}
            </span>
            <span className="text-muted-foreground/80">· {graph.scenes.length + draftNodes.length}</span>
            {selected ? (
              <span className="rounded-full border border-white/10 bg-background/65 px-2 py-1 text-muted-foreground shadow-strong backdrop-blur-xl">
                {selectedKindLabel}
              </span>
            ) : null}
            {selectedDraft ? (
              <span className="rounded-full border border-white/10 bg-background/65 px-2 py-1 text-muted-foreground shadow-strong backdrop-blur-xl">
                {SESSION_NODE_KIND_LABELS[selectedDraft.kind]}
              </span>
            ) : null}
            <div className="pointer-events-auto ml-auto inline-flex min-w-0 flex-wrap items-center justify-end gap-1 rounded-full border border-white/10 bg-background/60 p-1 shadow-strong backdrop-blur-xl">
              <div className="inline-flex rounded-full border border-border/70 bg-background/60 p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={camera === 'map'}
                  className={cn(
                    'h-7 rounded-full px-2.5 text-[11px]',
                    camera === 'map' && 'bg-foreground/10 shadow-thin',
                  )}
                  onClick={() => persistCamera('map')}
                >
                  {t('entityView.workbenchCameraMap')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={camera === 'flow'}
                  className={cn(
                    'h-7 rounded-full px-2.5 text-[11px]',
                    camera === 'flow' && 'bg-foreground/10 shadow-thin',
                  )}
                  onClick={() => persistCamera('flow')}
                >
                  {t('entityView.workbenchCameraFlow')}
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full border-white/10 bg-background/45 px-2.5 text-[11px] shadow-thin backdrop-blur-xl"
                onClick={() => {
                  flowRef.current?.fitView({ padding: 0.2 })
                }}
              >
                {t('entityView.mapFit')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-full border-white/10 bg-background/45 px-2.5 text-[11px] shadow-thin backdrop-blur-xl"
                onClick={resetLayout}
              >
                {t('entityView.mapResetLayout')}
              </Button>
            </div>
          </div>

          {selected && (
            <div className="pointer-events-auto absolute right-3 top-10 z-10 flex w-[min(18rem,calc(100%-1.5rem))] flex-col gap-2 rounded-xl border border-white/10 bg-background/70 p-3 shadow-strong backdrop-blur-2xl">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {selectedKindLabel}
                </span>
                <span className="truncate text-xs text-muted-foreground">{selected.triggerPreview || selected.id}</span>
              </div>
              <label className="sr-only" htmlFor="session-map-compose">
                {t('entityView.mapComposeLabel')}
              </label>
              <textarea
                id="session-map-compose"
                className="min-h-[96px] w-full resize-y rounded-[16px] border border-white/10 bg-background/55 px-2.5 py-2 text-xs shadow-minimal outline-none ring-0 backdrop-blur-xl placeholder:text-muted-foreground/60 focus:border-violet-400/60"
                placeholder={t('entityView.mapComposePlaceholder')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    const prompt = draft.trim()
                    if (prompt) onRewrite?.(selected.triggerMessageId, prompt)
                  }
                }}
              />
              <div className="inline-flex min-w-0 flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full border-white/10 bg-background/45 px-2.5 text-[11px] shadow-thin backdrop-blur-xl"
                  onClick={() => onFork?.(selected.triggerMessageId)}
                >
                  {t('entityView.workbenchFork')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full border-white/10 bg-background/45 px-2.5 text-[11px] shadow-thin backdrop-blur-xl"
                  onClick={() => setFanOutOpen(true)}
                >
                  {t('entityView.fanOutShort')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full border-white/10 bg-background/45 px-2.5 text-[11px] shadow-thin backdrop-blur-xl"
                  disabled={!draft.trim()}
                  onClick={() => {
                    const prompt = draft.trim()
                    if (prompt) onRewrite?.(selected.triggerMessageId, prompt)
                  }}
                >
                  {t('entityView.workbenchRewrite')}
                </Button>
              </div>
            </div>
          )}

          {graph.scenes.length === 0 && draftNodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
              <p>{t('entityView.workbenchNoScenes')}</p>
              <p className="text-xs">{t('entityView.mapEmptyHint')}</p>
            </div>
          ) : null}
          <ReactFlow
            className="h-full min-h-0 flex-1 w-full"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onPaneClick={() => {
              setSelectedId(null)
              setSelectedDraftEdgeId(null)
              setContextTargetId(null)
            }}
            onPaneContextMenu={(event) => {
              rememberContextPosition(event)
              setContextTargetId(selectedId ?? graph.scenes[0]?.id ?? null)
            }}
            onNodeContextMenu={(event, node) => {
              rememberContextPosition(event)
              if (node.type === 'scene' || node.type === 'draft') {
                setSelectedId(node.id)
                setSelectedDraftEdgeId(null)
                setContextTargetId(node.type === 'scene' ? node.id : null)
              }
            }}
            onEdgeContextMenu={(event, edge) => {
              rememberContextPosition(event)
              if (draftEdges.some((draftEdge) => draftEdge.id === edge.id)) {
                setSelectedId(null)
                setSelectedDraftEdgeId(edge.id)
                setContextTargetId(null)
              }
            }}
            onEdgeClick={(_event, edge) => {
              if (draftEdges.some((draftEdge) => draftEdge.id === edge.id)) {
                setSelectedId(null)
                setSelectedDraftEdgeId(edge.id)
                setContextTargetId(null)
              }
            }}
            onNodeClick={(_e, node) => {
              if (node.type === 'branch') {
                const id = (node.data as BranchNodeData).id
                onOpenSession?.(id)
                return
              }
              setSelectedId(node.id)
              setSelectedDraftEdgeId(null)
              setContextTargetId(node.type === 'scene' ? node.id : null)
            }}
            onNodeDoubleClick={(_e, node) => {
              const scene = sceneOf(node)
              if (scene) onOpenMessage?.(scene.triggerMessageId)
            }}
            onMoveEnd={(_e, vp) => {
              viewportRef.current = vp
              persistPin({
                v: 1,
                sessionId,
                camera,
                viewport: vp,
                nodes: pin?.nodes ?? {},
              })
            }}
            onNodeDragStop={(_e, node) => {
              if (isDraftFlowNode(node)) {
                persistDraftGraph({
                  nodes: draftNodes.map((draftNode) =>
                    draftNode.id === node.id
                      ? { ...draftNode, position: { x: node.position.x, y: node.position.y } }
                      : draftNode,
                  ),
                  edges: draftEdges,
                })
                return
              }
              if (node.type === 'scene') {
                persistPin({
                  v: 1,
                  sessionId,
                  camera,
                  ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
                  nodes: {
                    ...(pin?.nodes ?? {}),
                    [node.id]: { x: node.position.x, y: node.position.y },
                  },
                })
              }
            }}
            onInit={(inst) => {
              flowRef.current = inst
              if (pin?.viewport) inst.setViewport(pin.viewport)
              else inst.fitView({ padding: 0.2 })
            }}
            defaultEdgeOptions={{ type: 'default' }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            minZoom={0.15}
            maxZoom={2}
            panOnScroll
            colorMode="system"
            style={{
              width: '100%',
              height: '100%',
              background: 'hsl(var(--background))',
            }}
          >
            <Background gap={24} size={1} color="hsl(var(--border) / 0.4)" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="!rounded-xl !border !border-white/10 !bg-background/45 !shadow-strong !backdrop-blur-xl"
              maskColor="rgba(15, 16, 20, 0.18)"
              nodeColor="rgba(255, 255, 255, 0.22)"
            />
          </ReactFlow>

          <SessionFanOutSheet
            open={fanOutOpen}
            onOpenChange={setFanOutOpen}
            originScene={selected}
            playbookHoles={selected ? holesFromScene(selected) : []}
            onCreateChildSessions={onCreateChildSessions}
          />
        </div>
      </ContextMenuTrigger>
      <StyledContextMenuContent minWidth="min-w-64">
        <StyledContextMenuSub>
          <StyledContextMenuSubTrigger>Add node</StyledContextMenuSubTrigger>
          <StyledContextMenuSubContent minWidth="min-w-56">
            <StyledContextMenuItem onSelect={() => handleCreateNode('note')}>
              <FileText className="h-3.5 w-3.5" />
              {SESSION_NODE_KIND_LABELS.note}
            </StyledContextMenuItem>
            <StyledContextMenuItem onSelect={() => handleCreateNode('model')}>
              <Cpu className="h-3.5 w-3.5" />
              {SESSION_NODE_KIND_LABELS.model}
            </StyledContextMenuItem>
            <StyledContextMenuItem onSelect={() => handleCreateNode('tool')}>
              <DatabaseZap className="h-3.5 w-3.5" />
              {SESSION_NODE_KIND_LABELS.tool}
            </StyledContextMenuItem>
            <StyledContextMenuItem onSelect={() => handleCreateNode('memory')}>
              <Brain className="h-3.5 w-3.5" />
              {SESSION_NODE_KIND_LABELS.memory}
            </StyledContextMenuItem>
          </StyledContextMenuSubContent>
        </StyledContextMenuSub>
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onSelect={() => flowRef.current?.fitView({ padding: 0.2 })}>
          {t('entityView.mapFit')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onSelect={resetLayout}>
          {t('entityView.mapResetLayout')}
        </StyledContextMenuItem>
        {selected ? (
          <>
            <StyledContextMenuSeparator />
            <StyledContextMenuItem onSelect={() => onFork?.(selected.triggerMessageId)}>
              {t('entityView.workbenchFork')}
            </StyledContextMenuItem>
            <StyledContextMenuItem onSelect={() => setFanOutOpen(true)}>
              {t('entityView.fanOutShort')}
            </StyledContextMenuItem>
            <StyledContextMenuItem
              onSelect={() => {
                const prompt = draft.trim()
                if (prompt) onRewrite?.(selected.triggerMessageId, prompt)
              }}
            >
              {t('entityView.workbenchRewrite')}
            </StyledContextMenuItem>
          </>
        ) : null}
        {selectedDraft ? (
          <>
            <StyledContextMenuSeparator />
            <StyledContextMenuItem variant="destructive" onSelect={() => deleteDraftNode(selectedDraft.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete draft node
            </StyledContextMenuItem>
          </>
        ) : null}
        {selectedDraftEdgeId ? (
          <>
            <StyledContextMenuSeparator />
            <StyledContextMenuItem variant="destructive" onSelect={() => deleteDraftEdge(selectedDraftEdgeId)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete connection
            </StyledContextMenuItem>
          </>
        ) : null}
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

export function SessionWorkflowEditor(props: SessionWorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}
