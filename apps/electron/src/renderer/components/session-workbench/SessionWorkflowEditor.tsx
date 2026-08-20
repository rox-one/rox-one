import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnConnectEnd,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  parseSessionMapPin,
  projectSessionScenes,
  pruneSessionMapPin,
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

export type SessionWorkflowEditorProps = {
  sessionId: string
  messages: SceneMessage[]
  onFork?: (messageId: string) => void
  onRewrite?: (messageId: string, prompt: string) => void
  onCreateChildSessions?: (jobs: FanOutChildJob[]) => void | Promise<void>
  onOpenMessage?: (messageId: string) => void
}

const nodeTypes = { scene: SceneNode }

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
}: SessionWorkflowEditorProps) {
  const { t } = useTranslation()
  const [pin, setPin] = React.useState<SessionMapPin | null>(() => loadPin(sessionId))
  const [camera, setCamera] = React.useState<SessionMapCamera>(() => loadPin(sessionId)?.camera ?? 'map')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
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

  const graph = React.useMemo(
    () => projectSessionScenes(sessionId, messages),
    [sessionId, messages],
  )

  const { nodes: projected, edges: projectedEdges } = React.useMemo(
    () => toFlowElements(graph, pin, camera),
    [graph, pin, camera],
  )

  const [nodes, setNodes] = React.useState<Node[]>(projected as Node[])
  const projectedKey = React.useMemo(
    () => projected.map((n) => n.id).join('|') + ':' + camera + ':' + sessionId,
    [projected, camera, sessionId],
  )

  React.useEffect(() => {
    setNodes(
      projected.map((n) => ({
        ...n,
        selected: n.id === selectedId,
      })) as Node[],
    )
    // Keep pin positions; toFlowElements already applied pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection applied via selectedId separately
  }, [projectedKey, graph, pin, camera, projected])

  React.useEffect(() => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === selectedId })))
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

  const capturePositions = React.useCallback(
    (list: Node[], viewport?: Viewport): SessionMapPin => {
      const nodesMap: Record<string, { x: number; y: number }> = {}
      for (const n of list) nodesMap[n.id] = { x: n.position.x, y: n.position.y }
      const vp = viewport ?? viewportRef.current
      return pruneSessionMapPin({
        v: 1,
        sessionId,
        camera,
        ...(vp ? { viewport: vp } : {}),
        nodes: nodesMap,
      }, new Set(list.map((n) => n.id)))
    },
    [camera, sessionId],
  )

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
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground">{t('entityView.flowLive')}</span>
        <span className="text-muted-foreground">· {graph.scenes.length}</span>
        <div className="pointer-events-auto ml-auto inline-flex items-center gap-1">
          <div className="inline-flex rounded-md border border-border/60 bg-background/80 p-0.5 backdrop-blur">
            <button
              type="button"
              className={cn('rounded px-2 py-0.5', camera === 'map' && 'bg-foreground/10')}
              onClick={() => {
                setCamera('map')
                persistPin({
                  v: 1,
                  sessionId,
                  camera: 'map',
                  ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
                  nodes: pin?.nodes ?? {},
                })
              }}
            >
              {t('entityView.workbenchCameraMap')}
            </button>
            <button
              type="button"
              className={cn('rounded px-2 py-0.5', camera === 'flow' && 'bg-foreground/10')}
              onClick={() => {
                setCamera('flow')
                persistPin({
                  v: 1,
                  sessionId,
                  camera: 'flow',
                  ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
                  nodes: pin?.nodes ?? {},
                })
              }}
            >
              {t('entityView.workbenchCameraFlow')}
            </button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              const inst = flowRef.current
              inst?.fitView({ padding: 0.2 })
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
        <div className="pointer-events-auto absolute right-3 top-10 z-10 inline-flex items-center gap-1">
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
            {t('entityView.fanOutTitle')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onRewrite?.(selected.triggerMessageId, selected.triggerPreview)}
          >
            {t('entityView.workbenchRewrite')}
          </Button>
        </div>
      )}

      {graph.scenes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('entityView.workbenchNoScenes')}
        </div>
      ) : (
        <ReactFlow
          className="h-full min-h-0 flex-1"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onPaneClick={() => setSelectedId(null)}
          onNodeClick={(_e, node) => {
            setSelectedId(node.id)
          }}
          onNodeDoubleClick={(_e, node) => {
            const scene = sceneOf(node)
            if (scene) onOpenMessage?.(scene.triggerMessageId)
          }}
          onMoveEnd={(_e, vp) => {
            viewportRef.current = vp
            persistPin(capturePositions(nodes, vp))
          }}
          onNodeDragStop={() => {
            persistPin(capturePositions(nodes, viewportRef.current))
          }}
          onInit={(inst) => {
            flowRef.current = inst
            if (pin?.viewport) inst.setViewport(pin.viewport)
            else inst.fitView({ padding: 0.2 })
          }}
          defaultEdgeOptions={{ type: 'default' }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
          maxZoom={2}
          panOnScroll
          colorMode="system"
          style={{
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
        playbookHoles={[]}
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
