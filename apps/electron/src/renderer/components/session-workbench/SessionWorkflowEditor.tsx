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
import { toFlowElements, type FlowSceneNode } from './to-flow-elements'
import { holesFromScene } from './holes-from-scene'
import { markInteraction } from '@/perf/marks'

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
      className="w-[160px] min-w-0 rounded-[12px] border border-border bg-card px-2 py-1.5 text-left shadow-sm"
      title={data.name}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-border !bg-muted-foreground/50" />
      <div className="min-w-0 truncate text-xs font-medium">{data.name}</div>
    </div>
  )
}

const nodeTypes = { scene: SceneNode, branch: BranchNode }

function loadPin(sessionId: string): SessionMapPin | null {
  try {
    return parseSessionMapPin(localStorage.getItem(sessionMapPinStorageKey(sessionId)), sessionId)
  } catch {
    return null
  }
}

function sceneOf(node: Node | undefined): FlowSceneNode['data']['scene'] | null {
  const data = node?.data as FlowSceneNode['data'] | undefined
  return data?.scene ?? null
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
  const [camera, setCamera] = React.useState<SessionMapCamera>(() => loadPin(sessionId)?.camera ?? 'map')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [fanOutOpen, setFanOutOpen] = React.useState(false)
  const viewportRef = React.useRef<Viewport | undefined>(loadPin(sessionId)?.viewport)
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const flowRef = React.useRef<ReactFlowInstance | null>(null)

  React.useEffect(() => {
    const next = loadPin(sessionId)
    setPin(next)
    setCamera(next?.camera ?? 'map')
    viewportRef.current = next?.viewport
    setSelectedId(null)
  }, [sessionId])

  React.useEffect(() => {
    return () => {
      clearTimeout(persistTimer.current)
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

  const [nodes, setNodes] = React.useState<Node[]>(projected)
  const projectedKey = React.useMemo(
    () => projected.map((n) => n.id).join('|') + ':' + camera + ':' + sessionId,
    [projected, camera, sessionId],
  )

  React.useEffect(() => {
    setNodes(
      projected.map((n) => ({
        ...n,
        selected: n.id === selectedId,
      })),
    )
    // Keep pin positions; toFlowElements already applied pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection applied via selectedId separately
  }, [projectedKey, graph, pin, camera, projected])

  React.useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === selectedId })))
  }, [selectedId])

  React.useEffect(() => {
    const scene = graph.scenes.find((s) => s.id === selectedId)
    setDraft(scene?.triggerPreview ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-init draft only when selection changes
  }, [selectedId])

  const edges: Edge[] = React.useMemo(
    () =>
      projectedEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        data: e.data,
        style:
          e.data.kind === 'fork'
            ? { stroke: 'rgb(167 139 250)', strokeWidth: 2 }
            : { stroke: 'hsl(var(--border))', strokeWidth: 1.2 },
      })),
    [projectedEdges],
  )

  const persistPin = React.useCallback(
    (next: SessionMapPin) => {
      setPin(next)
      clearTimeout(persistTimer.current)
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
    (_c: Connection) => {
      toast.message(t('entityView.workbenchForkHint'))
    },
    [t],
  )

  const onConnectEnd = React.useCallback<OnConnectEnd>(
    (_event, state) => {
      if (state.toNode) return
      if (!state.fromNode) return
      const from = sceneOf(state.fromNode as Node | undefined)
      if (from) onFork?.(from.triggerMessageId)
    },
    [onFork],
  )

  const selected = graph.scenes.find((s) => s.id === selectedId) ?? null

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

  return (
    <div className="session-workflow-editor relative flex h-full min-h-0 flex-1 flex-col bg-background">
      <div
        role="toolbar"
        aria-label={t('entityView.map')}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex min-w-0 items-center gap-2 px-3 py-1.5 text-[11px]"
      >
        <span className="text-muted-foreground">{t('entityView.flowLive')}</span>
        <span className="text-muted-foreground">· {graph.scenes.length}</span>
        <div className="pointer-events-auto ml-auto inline-flex min-w-0 flex-wrap items-center justify-end gap-1">
          <div className="inline-flex rounded-md border border-border bg-background p-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={camera === 'map'}
              className={cn('h-7 px-2 text-[11px]', camera === 'map' && 'bg-foreground/10')}
              onClick={() => persistCamera('map')}
            >
              {t('entityView.workbenchCameraMap')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={camera === 'flow'}
              className={cn('h-7 px-2 text-[11px]', camera === 'flow' && 'bg-foreground/10')}
              onClick={() => persistCamera('flow')}
            >
              {t('entityView.workbenchCameraFlow')}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
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
            className="h-7 px-2 text-[11px]"
            onClick={resetLayout}
          >
            {t('entityView.mapResetLayout')}
          </Button>
        </div>
      </div>

      {selected && (
        <div className="pointer-events-auto absolute right-3 top-10 z-10 flex w-64 min-w-0 max-w-[min(16rem,calc(100%-1.5rem))] flex-col gap-1">
          <label className="sr-only" htmlFor="session-map-compose">
            {t('entityView.mapComposeLabel')}
          </label>
          <textarea
            id="session-map-compose"
            className="min-h-[72px] w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs"
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
              className="h-7 px-2 text-[11px]"
              onClick={() => onFork?.(selected.triggerMessageId)}
            >
              {t('entityView.workbenchFork')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => setFanOutOpen(true)}
            >
              {t('entityView.fanOutShort')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
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

      {graph.scenes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
          <p>{t('entityView.workbenchNoScenes')}</p>
          <p className="text-xs">{t('entityView.mapEmptyHint')}</p>
        </div>
      ) : (
        <ReactFlow
          className="h-full min-h-0 flex-1 w-full"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onPaneClick={() => setSelectedId(null)}
          onNodeClick={(_e, node) => {
            if (node.type === 'branch') {
              const id = (node.data as BranchNodeData).id
              onOpenSession?.(id)
              return
            }
            setSelectedId(node.id)
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
          }}
          onInit={(inst) => {
            flowRef.current = inst
            markInteraction('canvas-layout')
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
          <Background gap={20} size={1} color="hsl(var(--border))" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            className="!bg-background/80 !border-border"
            maskColor="hsl(var(--foreground) / 0.08)"
            nodeColor="hsl(var(--muted-foreground) / 0.35)"
          />
        </ReactFlow>
      )}

      <SessionFanOutSheet
        open={fanOutOpen}
        onOpenChange={setFanOutOpen}
        originScene={selected}
        playbookHoles={selected ? holesFromScene(selected) : []}
        onCreateChildSessions={onCreateChildSessions}
      />
    </div>
  )
}

export function SessionWorkflowEditor(props: SessionWorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}
