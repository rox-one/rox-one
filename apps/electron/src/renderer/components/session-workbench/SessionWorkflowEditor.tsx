import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  ConnectionMode,
  Handle,
  NodeResizer,
  Position,
  applyNodeChanges,
  getBezierPath,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Brain,
  Cpu,
  DatabaseZap,
  FileText,
  Flag,
  GitBranch,
  GitMerge,
  Plus,
  Split,
  Square,
  StickyNote,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { SessionFanOutSheet, type FanOutChildJob } from './SessionFanOutSheet'
import { SceneNode } from './SceneNode'
import { toFlowElements, type FlowSceneNode, type SceneNodeData } from './to-flow-elements'
import { holesFromScene } from './holes-from-scene'
import { isSessionMapEmpty } from './map-empty-actions'
import { mapToolbarDensity, mapToolbarLayout } from './map-toolbar-density'
import {
  createSessionDraftEdge,
  createSessionDraftNode,
  parseSessionDraftGraph,
  serializeSessionDraftGraph,
  sessionDraftNodesStorageKey,
  type SessionDraftGraph,
  type SessionDraftNode,
} from './draft-nodes'
import { deriveSessionNodeKind, SESSION_NODE_KINDS, type SessionNodeKind } from './node-kinds'
import {
  alignBoxes,
  distributeBoxes,
  keyboardConnectTarget,
  magneticPorts,
  tileBoxes,
  type AlignMode,
  type DistributeMode,
} from './canvas-layout'
import { sceneVisualStatus } from './SceneNode'
import {
  classifyMapConnection,
  connectionRejectMessageKey,
  contextNotesForScene,
  draftEdgeKind,
  withContextNotes,
} from './map-connection-rules'
import {
  defaultDraftSize,
  draftNodesWithSize,
  MIN_DRAFT_SIZE,
  nodeBox,
  pinWithSceneSize,
  type NodeSize,
} from './map-node-size'
import { shortSceneTitle } from './scene-tools'
import { draftGraphToSpec, loadWorkflowDocument, persistWorkflowDocument, specToDraftGraph } from './workflow-document'
import {
  compareVersions,
  exportSpec,
  forkVersion,
  importSpec,
  promoteTraceToDraft,
  recordRun,
  replayRun,
  runWorkflow,
  saveVersion,
  convertNodeKind,
  isProductionWorkflowSuccess,
  type WorkflowRun,
} from '@craft-agent/shared/workflows'

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

const SESSION_NODE_KIND_I18N: Record<SessionNodeKind, string> = {
  note: 'entityView.mapKindNote',
  model: 'entityView.mapKindModel',
  tool: 'entityView.mapKindTool',
  memory: 'entityView.mapKindMemory',
  subflow: 'entityView.mapKindSubflow',
  condition: 'entityView.mapKindCondition',
  merge: 'entityView.mapKindMerge',
  human_input: 'entityView.mapKindHumanInput',
  output: 'entityView.mapKindOutput',
  annotation_frame: 'entityView.mapKindFrame',
}

const SESSION_DRAFT_PROMPT_I18N: Record<SessionNodeKind, string> = {
  note: 'entityView.mapDraftNote',
  model: 'entityView.mapDraftModel',
  tool: 'entityView.mapDraftTool',
  memory: 'entityView.mapDraftMemory',
  subflow: 'entityView.mapDraftSubflow',
  condition: 'entityView.mapDraftCondition',
  merge: 'entityView.mapDraftMerge',
  human_input: 'entityView.mapDraftHumanInput',
  output: 'entityView.mapDraftOutput',
  annotation_frame: 'entityView.mapDraftFrame',
}

const PALETTE_ICONS: Record<SessionNodeKind, LucideIcon> = {
  note: FileText,
  model: Cpu,
  tool: DatabaseZap,
  memory: Brain,
  subflow: GitBranch,
  condition: Split,
  merge: GitMerge,
  human_input: UserRound,
  output: Flag,
  annotation_frame: Square,
}


function BranchNode({ data }: NodeProps<Node<BranchNodeData, 'branch'>>) {
  return (
    <div
      className="w-[168px] min-w-0 rounded-xl bg-card/80 px-2.5 py-1.5 text-left shadow-strong backdrop-blur-xl"
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
  placeholder: string
  deleteAriaLabel: string
  runStatus?: string
  /** Short title of the scene this note is anchored to (never the raw scn_ id). */
  anchorLabel?: string | null
  onChangeTitle: (id: string, title: string) => void
  onDelete: (id: string) => void
  onResize: (id: string, box: { x: number; y: number } & NodeSize) => void
}

const DRAFT_NODE_ICONS: Record<SessionNodeKind, LucideIcon> = PALETTE_ICONS

function notifyWorkflowRun(run: WorkflowRun, t: (key: string) => string) {
  if (isProductionWorkflowSuccess(run)) {
    toast.success(t('entityView.mapRunComplete'))
    return
  }
  if (Object.values(run.status).includes('waiting_approval')) {
    toast.warning(t('entityView.mapRunWaitingApproval'))
    return
  }
  toast.info(t('entityView.mapRunSimulated'))
}

function draftRunStatusClassName(status: string): string {
  if (status === 'waiting_approval') {
    return 'bg-amber-400/15 text-amber-200'
  }
  if (status === 'done') {
    return 'bg-emerald-400/15 text-emerald-200'
  }
  return 'bg-foreground/[0.06] text-muted-foreground'
}

function draftRunStatusLabel(status: string, t: (key: string) => string): string {
  if (status === 'waiting_approval') return t('entityView.mapRunStatus.waiting_approval')
  if (status === 'simulated') return t('entityView.mapRunStatus.simulated')
  return status
}

function DraftNode({ id, data, selected }: NodeProps<Node<DraftNodeData, 'draft'>>) {
  const { t } = useTranslation()
  const Icon = DRAFT_NODE_ICONS[data.draft.kind]
  const role = data.draft.role ?? 'node'
  return (
    <div
      data-role={role}
      className={cn(
        // Flat surfaces, no nested outlines; selection is one accent ring.
        'group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg p-2 text-left',
        role === 'sticky' && 'bg-amber-300/20',
        role === 'frame' && 'bg-foreground/[0.02] outline-dashed outline-1 outline-foreground/10',
        role === 'group' && 'bg-violet-400/[0.06]',
        role === 'node' && 'bg-foreground/[0.05]',
        selected && 'ring-2 ring-accent',
      )}
    >
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={MIN_DRAFT_SIZE.width}
        minHeight={MIN_DRAFT_SIZE.height}
        lineClassName="!border-accent/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-0 !bg-accent"
        onResizeEnd={(_event, box) => data.onResize(id, box)}
      />
      <Handle type="target" position={Position.Left} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-foreground/40" />
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {data.kindLabel}
        </span>
        {data.runStatus ? (
          <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px]', draftRunStatusClassName(data.runStatus))}>
            {draftRunStatusLabel(data.runStatus, t)}
          </span>
        ) : null}
        <button
          type="button"
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground group-hover:opacity-70 focus-visible:opacity-100"
          aria-label={data.deleteAriaLabel}
          onClick={(event) => {
            event.stopPropagation()
            data.onDelete(data.draft.id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {data.anchorLabel ? (
        <div className="mb-1 min-w-0 truncate text-[10px] text-muted-foreground/80" title={data.anchorLabel}>
          ↳ {data.anchorLabel}
        </div>
      ) : null}
      <textarea
        className="nodrag nowheel min-h-[48px] w-full flex-1 resize-none rounded-md bg-transparent px-1 py-1 text-xs leading-4 outline-none placeholder:text-muted-foreground/50 focus:bg-foreground/[0.04]"
        value={data.draft.title}
        placeholder={data.placeholder}
        onChange={(event) => data.onChangeTitle(data.draft.id, event.target.value)}
      />
      <Handle type="source" position={Position.Right} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-foreground/40" />
    </div>
  )
}

/** Connection preview: accent when the drop target is valid, red when not. */
function MapConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  })
  const stroke =
    connectionStatus === 'valid'
      ? 'rgb(52 211 153)'
      : connectionStatus === 'invalid'
        ? 'rgb(251 113 133)'
        : 'rgb(148 163 184)'
  return (
    <g data-connection-status={connectionStatus ?? 'none'}>
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.8} strokeDasharray="5 4" />
      <circle cx={toX} cy={toY} r={3} fill={stroke} />
    </g>
  )
}

/** Primary node types offered by the canvas «+» picker and double-click. */
type MapPickerItem =
  | { id: string; kind: SessionNodeKind; chrome?: undefined; labelKey: string; icon: LucideIcon }
  | { id: string; chrome: 'sticky' | 'frame' | 'group'; kind?: undefined; labelKey: string; icon: LucideIcon }

const MAP_PICKER_PRIMARY: MapPickerItem[] = [
  { id: 'note', kind: 'note', labelKey: 'entityView.mapKindNote', icon: FileText },
  { id: 'sticky', chrome: 'sticky', labelKey: 'entityView.mapSticky', icon: StickyNote },
  { id: 'model', kind: 'model', labelKey: 'entityView.mapKindModel', icon: Cpu },
  { id: 'tool', kind: 'tool', labelKey: 'entityView.mapKindTool', icon: DatabaseZap },
  { id: 'condition', kind: 'condition', labelKey: 'entityView.mapKindCondition', icon: Split },
  { id: 'output', kind: 'output', labelKey: 'entityView.mapKindOutput', icon: Flag },
  { id: 'frame', chrome: 'frame', labelKey: 'entityView.mapFrame', icon: Square },
]

const MAP_PICKER_MORE: MapPickerItem[] = [
  { id: 'memory', kind: 'memory', labelKey: 'entityView.mapKindMemory', icon: Brain },
  { id: 'subflow', kind: 'subflow', labelKey: 'entityView.mapKindSubflow', icon: GitBranch },
  { id: 'merge', kind: 'merge', labelKey: 'entityView.mapKindMerge', icon: GitMerge },
  { id: 'human_input', kind: 'human_input', labelKey: 'entityView.mapKindHumanInput', icon: UserRound },
  { id: 'group', chrome: 'group', labelKey: 'entityView.mapGroup', icon: Square },
]

type NodeMenuState =
  | { x: number; y: number; target: 'scene' | 'draft'; id: string }
  | { x: number; y: number; target: 'edge'; id: string }

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
  const [workflowDoc, setWorkflowDoc] = React.useState(() => loadWorkflowDocument(sessionId, loadDraftGraph(sessionId)))
  const importRef = React.useRef<HTMLInputElement>(null)
  const [camera, setCamera] = React.useState<SessionMapCamera>(() => loadPin(sessionId)?.camera ?? 'map')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedDraftEdgeId, setSelectedDraftEdgeId] = React.useState<string | null>(null)
  const [contextTargetId, setContextTargetId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [fanOutOpen, setFanOutOpen] = React.useState(false)
  /** Canvas node-type picker («+» button or double-click on empty canvas). */
  const [picker, setPicker] = React.useState<{ left: number; top: number } | null>(null)
  const [pickerMore, setPickerMore] = React.useState(false)
  /** Node-only context menu (never on the empty canvas). */
  const [nodeMenu, setNodeMenu] = React.useState<NodeMenuState | null>(null)
  const canvasRef = React.useRef<HTMLDivElement>(null)
  const viewportRef = React.useRef<Viewport | undefined>(loadPin(sessionId)?.viewport)
  const persistTimer = React.useRef<number | undefined>(undefined)
  const flowRef = React.useRef<ReactFlowInstance | null>(null)
  // Toolbar row width drives which controls stay inline vs. move into ⋯.
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const [toolbarWidth, setToolbarWidth] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    setToolbarWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    // Border-box width (same measure as the initial read above).
    const observer = new ResizeObserver(() => {
      setToolbarWidth(el.getBoundingClientRect().width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const toolbarLayout = mapToolbarLayout(mapToolbarDensity(toolbarWidth))
  const contextPositionRef = React.useRef<{ x: number; y: number }>({ x: 24, y: 24 })
  const hasContextPositionRef = React.useRef(false)
  const draftNodes = draftGraph.nodes
  const draftEdges = draftGraph.edges

  React.useEffect(() => {
    const next = loadPin(sessionId)
    const nextDraft = loadDraftGraph(sessionId)
    setPin(next)
    setDraftGraph(nextDraft)
    setWorkflowDoc(loadWorkflowDocument(sessionId, nextDraft))
    setCamera(next?.camera ?? 'map')
    viewportRef.current = next?.viewport
    setSelectedId(null)
    setSelectedDraftEdgeId(null)
    setContextTargetId(null)
    setPicker(null)
    setNodeMenu(null)
  }, [sessionId])

  React.useEffect(() => {
    return () => {
      window.clearTimeout(persistTimer.current)
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
      setWorkflowDoc((prev) => {
        const spec = draftGraphToSpec(nextGraph)
        const nextDoc = {
          ...prev,
          sessionId,
          draft: {
            ...spec,
            id: prev.draft.id,
            versionId: prev.draft.versionId,
            parentVersionId: prev.draft.parentVersionId,
            title: prev.draft.title,
            defaults: prev.draft.defaults,
          },
        }
        persistWorkflowDocument(nextDoc)
        return nextDoc
      })
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

  const resizeScene = React.useCallback(
    (id: string, box: { x: number; y: number } & NodeSize) => {
      persistPin(
        pinWithSceneSize(pin, { sessionId, camera, viewport: viewportRef.current }, id, box),
      )
    },
    // persistPin is declared below; it is stable for a given session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [camera, pin, sessionId],
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
            kindLabel: t('entityView.mapKindInferred', { kind: t(SESSION_NODE_KIND_I18N[data.kind]) }),
            onResize: resizeScene,
          },
        }
      }),
    [projected, resizeScene, t],
  )

  const resizeDraft = React.useCallback(
    (id: string, box: { x: number; y: number } & NodeSize) => {
      persistDraftGraph({ nodes: draftNodesWithSize(draftNodes, id, box), edges: draftEdges })
    },
    [draftEdges, draftNodes, persistDraftGraph],
  )

  const lastRun = workflowDoc.runs[workflowDoc.runs.length - 1] as WorkflowRun | undefined
  const draftFlowNodes = React.useMemo<Node<DraftNodeData, 'draft'>[]>(
    () =>
      draftNodes.map((draftNode) => {
        const size = draftNode.size ?? defaultDraftSize(draftNode.role)
        const anchor = draftNode.anchorSceneId
          ? graph.scenes.find((scene) => scene.id === draftNode.anchorSceneId)
          : undefined
        return {
          id: draftNode.id,
          type: 'draft' as const,
          position: draftNode.position,
          width: size.width,
          ...(draftNode.size ? { height: draftNode.size.height } : {}),
          data: {
            draft: draftNode,
            kindLabel: t(SESSION_NODE_KIND_I18N[draftNode.kind]),
            placeholder: t(SESSION_DRAFT_PROMPT_I18N[draftNode.kind]),
            deleteAriaLabel: t('entityView.mapDeleteDraftNode'),
            runStatus: lastRun?.status[draftNode.id],
            anchorLabel: shortSceneTitle(anchor),
            onChangeTitle: updateDraftTitle,
            onDelete: deleteDraftNode,
            onResize: resizeDraft,
          },
        }
      }),
    [deleteDraftNode, draftNodes, graph.scenes, lastRun, resizeDraft, t, updateDraftTitle],
  )

  const flowSeedNodes = React.useMemo(
    () => [...labeledProjected, ...draftFlowNodes],
    [draftFlowNodes, labeledProjected],
  )

  const [nodes, setNodes] = React.useState<Node[]>(flowSeedNodes)
  const projectedKey = React.useMemo(
    () =>
      flowSeedNodes
        .map((n) => `${n.id}:${n.position.x}:${n.position.y}:${n.width ?? ''}x${n.height ?? ''}:${isDraftFlowNode(n) ? n.data.draft.title : ''}`)
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
      const draftFlowEdges: Edge[] = draftEdges.map((edge) => {
        const kind = draftEdgeKind(edge)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: { kind: kind === 'context' ? 'context' : 'draft' },
          selected: edge.id === selectedDraftEdgeId,
          // Every user-drawn edge says what it means: workflow step or context link.
          label: kind === 'context' ? t('entityView.mapEdgeContext') : t('entityView.mapEdgeStep'),
          labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
          labelBgStyle: { fill: 'var(--background)', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style:
            kind === 'context'
              ? { stroke: 'rgb(251 191 36)', strokeWidth: 1.4, strokeDasharray: '2 4' }
              : { stroke: 'rgb(96 165 250)', strokeWidth: 1.8, strokeDasharray: '5 4' },
        }
      })
      return [...sceneEdges, ...draftFlowEdges]
    },
    [draftEdges, projectedEdges, selectedDraftEdgeId, t],
  )

  const persistPin = React.useCallback(
    (next: SessionMapPin) => {
      setPin(next)
      window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(() => {
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

  const sceneIds = React.useMemo(() => new Set(graph.scenes.map((scene) => scene.id)), [graph.scenes])

  const verdictFor = React.useCallback(
    (connection: { source?: string | null; target?: string | null }) =>
      classifyMapConnection(connection, { draftNodes, draftEdges, sceneIds }),
    [draftEdges, draftNodes, sceneIds],
  )

  // Hover feedback while dragging a connection (valid → green line, invalid → red).
  const isValidConnection = React.useCallback(
    (connection: Edge | Connection) => verdictFor(connection).ok,
    [verdictFor],
  )

  const onConnect = React.useCallback(
    (connection: Connection) => {
      const verdict = verdictFor(connection)
      if (!verdict.ok) {
        toast.message(t(connectionRejectMessageKey(verdict.reason)))
        return
      }
      const next = createSessionDraftEdge({ source: verdict.source, target: verdict.target, kind: verdict.kind })
      persistDraftGraph({ nodes: draftNodes, edges: [...draftEdges, next] })
    },
    [draftEdges, draftNodes, persistDraftGraph, t, verdictFor],
  )

  const rememberContextPosition = React.useCallback((event: MouseEvent | React.MouseEvent) => {
    const next = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (next) {
      contextPositionRef.current = next
      hasContextPositionRef.current = true
    }
  }, [])

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
        title: t(SESSION_DRAFT_PROMPT_I18N[kind]),
      })
      persistDraftGraph({ nodes: [...draftNodes, next], edges: draftEdges })
      setSelectedId(next.id)
    },
    [anchorScene?.id, draftEdges, draftNodes, persistDraftGraph, t],
  )

  const handleCreateChrome = React.useCallback(
    (role: 'sticky' | 'frame' | 'group') => {
      const position = hasContextPositionRef.current
        ? contextPositionRef.current
        : { x: 48, y: 48 }
      const next = createSessionDraftNode({
        kind: 'note',
        position,
        anchorSceneId: anchorScene?.id ?? null,
        title: t(
          role === 'sticky'
            ? 'entityView.mapSticky'
            : role === 'frame'
              ? 'entityView.mapFrame'
              : 'entityView.mapGroup',
        ),
        role,
      })
      persistDraftGraph({ nodes: [...draftNodes, next], edges: draftEdges })
      setSelectedId(next.id)
    },
    [anchorScene?.id, draftEdges, draftNodes, persistDraftGraph, t],
  )

  const boxOf = React.useCallback(
    (node: Node) =>
      nodeBox(node, isDraftFlowNode(node) ? defaultDraftSize(node.data.draft.role) : undefined),
    [],
  )

  const applyCanvasLayout = React.useCallback(
    (mode: AlignMode | DistributeMode | 'tile') => {
      const selectedBoxes = nodes
        .filter((node) => node.selected)
        .map((node) => boxOf(node))
      const nextBoxes =
        mode === 'tile'
          ? tileBoxes(selectedBoxes.length ? selectedBoxes : nodes.map((node) => boxOf(node)))
          : mode === 'horizontal' || mode === 'vertical'
            ? distributeBoxes(selectedBoxes, mode)
            : alignBoxes(selectedBoxes, mode)
      if (nextBoxes.length === 0) return
      const byId = new Map(nextBoxes.map((box) => [box.id, box]))
      persistDraftGraph({
        nodes: draftNodes.map((node) => {
          const box = byId.get(node.id)
          return box ? { ...node, position: { x: box.x, y: box.y } } : node
        }),
        edges: draftEdges,
      })
      persistPin({
        v: 1,
        sessionId,
        camera,
        ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
        nodes: {
          ...(pin?.nodes ?? {}),
          ...Object.fromEntries(
            nextBoxes
              .filter((box) => !draftNodes.some((draft) => draft.id === box.id))
              .map((box) => [box.id, { ...(pin?.nodes[box.id] ?? {}), x: box.x, y: box.y }]),
          ),
        },
      })
    },
    [boxOf, camera, draftEdges, draftNodes, nodes, persistDraftGraph, persistPin, pin?.nodes, sessionId],
  )

  const currentSpec = React.useCallback(() => {
    const spec = draftGraphToSpec({ v: 1, sessionId, nodes: draftNodes, edges: draftEdges })
    return {
      ...spec,
      id: workflowDoc.draft.id,
      versionId: workflowDoc.draft.versionId,
      parentVersionId: workflowDoc.draft.parentVersionId,
      title: workflowDoc.draft.title,
    }
  }, [draftEdges, draftNodes, sessionId, workflowDoc.draft])

  const handleSaveVersion = React.useCallback(() => {
    try {
      const next = saveVersion({ ...workflowDoc, draft: currentSpec() })
      setWorkflowDoc(next)
      persistWorkflowDocument(next)
      toast.success(t('entityView.mapVersionSaved'))
    } catch (error) {
      toast.error(t('entityView.mapValidationBlocked'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [currentSpec, t, workflowDoc])

  const handlePromoteTrace = React.useCallback(() => {
    const promoted = promoteTraceToDraft({ sessionId, scenes: graph.scenes })
    const extras = draftNodes.filter((node) => !node.anchorSceneId && !promoted.nodes.some((item) => item.id === node.id))
    persistDraftGraph({
      nodes: [...specToDraftGraph(promoted).nodes, ...extras],
      edges: [
        ...specToDraftGraph(promoted).edges,
        ...draftEdges.filter((edge) => extras.some((node) => node.id === edge.source || node.id === edge.target)),
      ],
    })
    toast.success(t('entityView.mapPromoteTrace'))
  }, [draftEdges, draftNodes, graph.scenes, persistDraftGraph, sessionId, t])

  const handleRun = React.useCallback(
    (mode: 'node' | 'from-here' | 'selection' | 'pipeline') => {
      try {
        let document = { ...workflowDoc, draft: currentSpec() }
        document = saveVersion(document)
        const spec = document.versions[document.versions.length - 1] ?? document.draft
        const seedIds =
          mode === 'pipeline'
            ? []
            : mode === 'selection'
              ? nodes.filter((node) => node.selected).map((node) => node.id)
              : selectedId
                ? [selectedId]
                : []
        const run = runWorkflow({ spec, mode, seedIds })
        const next = recordRun(document, run)
        setWorkflowDoc(next)
        persistWorkflowDocument(next)
        notifyWorkflowRun(run, t)
      } catch (error) {
        toast.error(t('entityView.mapValidationBlocked'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [currentSpec, nodes, selectedId, t, workflowDoc],
  )

  const handleReplay = React.useCallback(() => {
    const previous = workflowDoc.runs[workflowDoc.runs.length - 1]
    const version = workflowDoc.versions.find((item) => item.versionId === previous?.specVersionId)
    if (!previous || !version) {
      toast.error(t('entityView.mapValidationBlocked'))
      return
    }
    try {
      const run = replayRun(version, previous)
      const next = recordRun(workflowDoc, run)
      setWorkflowDoc(next)
      persistWorkflowDocument(next)
      notifyWorkflowRun(run, t)
    } catch (error) {
      toast.error(t('entityView.mapValidationBlocked'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [t, workflowDoc])

  const handleForkVersion = React.useCallback(() => {
    const version = workflowDoc.versions[workflowDoc.versions.length - 1]
    if (!version) {
      toast.error(t('entityView.mapValidationBlocked'))
      return
    }
    const next = forkVersion(workflowDoc, version.versionId)
    setWorkflowDoc(next)
    persistWorkflowDocument(next)
    persistDraftGraph(specToDraftGraph(next.draft))
  }, [persistDraftGraph, t, workflowDoc])

  const handleCompareVersions = React.useCallback(() => {
    const [older, newer] = workflowDoc.versions.slice(-2)
    if (!older || !newer) {
      toast.message(t('entityView.mapCompareVersions'))
      return
    }
    const diff = compareVersions(older, newer)
    toast.message(t('entityView.mapCompareVersions'), {
      description: `+${diff.addedNodes.length}/-${diff.removedNodes.length} nodes`,
    })
  }, [t, workflowDoc.versions])

  const handleExport = React.useCallback(() => {
    const blob = new Blob([exportSpec(currentSpec())], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${sessionId}.workflow.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [currentSpec, sessionId])

  const handleImport = React.useCallback(
    async (file: File) => {
      try {
        const spec = importSpec(await file.text(), sessionId)
        persistDraftGraph(specToDraftGraph(spec))
      } catch (error) {
        toast.error(t('entityView.mapValidationBlocked'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [persistDraftGraph, sessionId, t],
  )

  const handleConvert = React.useCallback(
    (kind: SessionNodeKind) => {
      if (!selectedId || !draftNodes.some((node) => node.id === selectedId)) return
      persistDraftGraph({
        nodes: draftNodes.map((node) => {
          if (node.id !== selectedId) return node
          const converted = convertNodeKind(
            draftGraphToSpec({ v: 1, sessionId, nodes: [node], edges: [] }).nodes[0]!,
            kind,
          )
          return { ...node, kind: converted.kind, title: node.title }
        }),
        edges: draftEdges,
      })
    },
    [draftEdges, draftNodes, persistDraftGraph, selectedId, sessionId],
  )

  const selected = graph.scenes.find((s) => s.id === selectedId) ?? null
  const mapEmpty = isSessionMapEmpty({ scenes: graph.scenes, draftNodes })
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
  const selectedKindLabel = selectedKind ? t('entityView.mapKindInferred', { kind: t(SESSION_NODE_KIND_I18N[selectedKind]) }) : ''
  const selectedStatus = selected ? sceneVisualStatus(selected.tools, true) : null
  const selectedContextNotes = React.useMemo(
    () => (selected ? contextNotesForScene(selected.id, draftGraph) : []),
    [draftGraph, selected],
  )

  React.useEffect(() => {
    if (!selected) return
    const status = sceneVisualStatus(selected.tools)
    if (status !== 'running' && status !== 'waiting') return
    flowRef.current?.fitView({ nodes: [{ id: selected.id }], padding: 0.35 })
  }, [selected])

  /**
   * «Переписать в новой ветке»: creates a branch from the scene with the new
   * prompt. Notes attached to the scene with context edges are appended.
   */
  const rewriteScene = React.useCallback(
    (scene: NonNullable<typeof selected>, prompt: string) => {
      const text = prompt.trim()
      if (!text) return
      const notes = contextNotesForScene(scene.id, draftGraph)
      onRewrite?.(scene.triggerMessageId, withContextNotes(text, notes, t('entityView.mapContextNotesHeading')))
    },
    [draftGraph, onRewrite, t],
  )
  const rewriteSelected = (prompt: string) => {
    if (selected) rewriteScene(selected, prompt)
  }

  const closeInspector = React.useCallback(() => {
    setSelectedId(null)
    setContextTargetId(null)
  }, [])

  const openPicker = React.useCallback((clientX: number, clientY: number, flowPosition?: { x: number; y: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = flowPosition ?? flowRef.current?.screenToFlowPosition({ x: clientX, y: clientY })
    if (position) {
      contextPositionRef.current = position
      hasContextPositionRef.current = true
    }
    setNodeMenu(null)
    setPickerMore(false)
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))
    setPicker({
      left: clamp(clientX - rect.left, 8, rect.width - 216),
      top: clamp(clientY - rect.top, 8, rect.height - 320),
    })
  }, [])

  const openPickerFromPlus = React.useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const center = flowRef.current?.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })
    openPicker(rect.left + 12, rect.bottom - 332, center)
  }, [openPicker])

  const pickNodeType = (item: MapPickerItem) => {
    setPicker(null)
    switch (item.id) {
      case 'note':
        handleCreateNode('note')
        return
      case 'sticky':
        handleCreateChrome('sticky')
        return
      case 'frame':
        handleCreateChrome('frame')
        return
      case 'group':
        handleCreateChrome('group')
        return
      default:
        if (item.kind) handleCreateNode(item.kind)
    }
  }

  /** Create a note next to a scene and attach it as context (scene → note). */
  const attachNoteToScene = React.useCallback(
    (sceneId: string) => {
      const sceneNode = nodes.find((node) => node.id === sceneId)
      const box = sceneNode ? boxOf(sceneNode) : { x: 24, y: 24, width: 220, height: 96 }
      const note = createSessionDraftNode({
        kind: 'note',
        position: { x: box.x + box.width + 48, y: box.y },
        anchorSceneId: sceneId,
        title: '',
      })
      const edge = createSessionDraftEdge({ source: sceneId, target: note.id, kind: 'context' })
      persistDraftGraph({ nodes: [...draftNodes, note], edges: [...draftEdges, edge] })
      setSelectedId(note.id)
      setContextTargetId(null)
    },
    [boxOf, draftEdges, draftNodes, nodes, persistDraftGraph],
  )

  const menuScene = nodeMenu?.target === 'scene' ? graph.scenes.find((scene) => scene.id === nodeMenu.id) ?? null : null
  const menuDraft = nodeMenu?.target === 'draft' ? draftNodes.find((node) => node.id === nodeMenu.id) ?? null : null
  const inspectorOpen = Boolean(selected || selectedDraft)
  const selectedDraftAnchor = selectedDraft?.anchorSceneId
    ? shortSceneTitle(graph.scenes.find((scene) => scene.id === selectedDraft.anchorSceneId))
    : null

  const inspectorButton = 'h-7 justify-start rounded-md px-2 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'

  return (
        <div
          className="session-workflow-editor relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (picker) {
                event.preventDefault()
                setPicker(null)
                return
              }
              if (inspectorOpen) {
                event.preventDefault()
                closeInspector()
              }
              return
            }
            if (!selectedId) return
            if (!(event.altKey || event.metaKey) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const direction =
              event.key === 'ArrowLeft' ? 'left'
                : event.key === 'ArrowRight' ? 'right'
                  : event.key === 'ArrowUp' ? 'top'
                    : 'bottom'
            const boxes = nodes.map((node) => boxOf(node))
            const target = keyboardConnectTarget(selectedId, direction, boxes)
            if (!target) return
            const fromBox = boxes.find((box) => box.id === selectedId)
            const toBox = boxes.find((box) => box.id === target)
            const magnet = fromBox && toBox ? magneticPorts(fromBox, toBox) : null
            const verdict = verdictFor({ source: selectedId, target })
            if (verdict.ok) {
              const next = createSessionDraftEdge({ source: verdict.source, target: verdict.target, kind: verdict.kind })
              persistDraftGraph({ nodes: draftNodes, edges: [...draftEdges, next] })
            }
            void magnet
          }}
        >
          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={t('entityView.map')}
            data-testid="map-toolbar"
            className="relative z-10 flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-x-auto px-3 py-1.5 text-[11px]"
          >
            <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap">
              {toolbarLayout.showLiveChip ? (
                <span className="shrink-0 rounded-full bg-foreground/[0.05] px-2 py-1 text-muted-foreground">
                  {t('entityView.flowLive')}
                </span>
              ) : null}
              {toolbarLayout.showSceneCount ? (
                <span className="shrink-0 text-muted-foreground/80">· {graph.scenes.length + draftNodes.length}</span>
              ) : null}
              {toolbarLayout.showKindChips && selected ? (
                <span className="min-w-0 truncate rounded-full bg-foreground/[0.05] px-2 py-1 text-muted-foreground">
                  {selectedKindLabel}
                </span>
              ) : null}
              {toolbarLayout.showKindChips && selectedDraft ? (
                <span className="min-w-0 truncate rounded-full bg-foreground/[0.05] px-2 py-1 text-muted-foreground">
                  {t(SESSION_NODE_KIND_I18N[selectedDraft.kind])}
                </span>
              ) : null}
            </div>
            <div className="map-toolbar-group ml-auto inline-flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap">
              {toolbarLayout.inlineCamera ? (
              <div className="inline-flex gap-0.5" role="group" aria-label={t('entityView.mapToolbarView')}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={camera === 'map'}
                  className={cn(
                    'map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                    camera === 'map' && 'bg-foreground/10 text-foreground hover:bg-foreground/10',
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
                    'map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                    camera === 'flow' && 'bg-foreground/10 text-foreground hover:bg-foreground/10',
                  )}
                  onClick={() => persistCamera('flow')}
                >
                  {t('entityView.workbenchCameraFlow')}
                </Button>
              </div>
              ) : null}
              {toolbarLayout.inlineLayoutActions ? (
              <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                onClick={() => {
                  flowRef.current?.fitView({ padding: 0.2 })
                }}
              >
                {t('entityView.mapFit')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                onClick={resetLayout}
              >
                {t('entityView.mapResetLayout')}
              </Button>
              </>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                disabled={!selected}
                onClick={() => rewriteSelected(draft.trim() || selected?.triggerPreview || '')}
              >
                {t('entityView.mapRun')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    data-testid="map-toolbar-more"
                    aria-label={t('entityView.mapMoreActions')}
                  >
                    ⋯
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem]">
                  {mapEmpty ? (
                    <DropdownMenuItem disabled data-testid="map-toolbar-empty-hint">
                      {t('entityView.mapEmptyHint')}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      {!toolbarLayout.inlineCamera ? (
                        <>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            {t('entityView.mapToolbarView')}
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={camera}
                            onValueChange={(value) => persistCamera(value === 'flow' ? 'flow' : 'map')}
                          >
                            <DropdownMenuRadioItem value="map" data-testid="map-toolbar-menu-camera-map">
                              {t('entityView.workbenchCameraMap')}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="flow" data-testid="map-toolbar-menu-camera-flow">
                              {t('entityView.workbenchCameraFlow')}
                            </DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          <DropdownMenuSeparator />
                        </>
                      ) : null}
                      {!toolbarLayout.inlineLayoutActions ? (
                        <>
                          <DropdownMenuItem
                            data-testid="map-toolbar-menu-fit"
                            onClick={() => {
                              flowRef.current?.fitView({ padding: 0.2 })
                            }}
                          >
                            {t('entityView.mapFit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid="map-toolbar-menu-reset-layout" onClick={resetLayout}>
                            {t('entityView.mapResetLayout')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      ) : null}
                      <DropdownMenuItem onClick={() => applyCanvasLayout('left')}>
                        {t('entityView.mapAlign')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyCanvasLayout('horizontal')}>
                        {t('entityView.mapDistribute')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => applyCanvasLayout('tile')}>
                        {t('entityView.mapTile')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handlePromoteTrace}>
                        {t('entityView.mapPromoteTrace')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleSaveVersion}>
                        {t('entityView.mapSaveVersion')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleRun('pipeline')}>
                        {t('entityView.mapRunPipeline')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExport}>
                        {t('entityView.mapExportSpec')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleForkVersion}>
                        {t('entityView.mapForkVersion')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleCompareVersions}>
                        {t('entityView.mapCompareVersions')}
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem data-testid="map-toolbar-import" onClick={() => importRef.current?.click()}>
                    {t('entityView.mapImportSpec')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleImport(file)
                  event.currentTarget.value = ''
                }}
              />
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1">
          <div ref={canvasRef} className="relative min-h-0 min-w-0 flex-1">
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
            connectionMode={ConnectionMode.Loose}
            isValidConnection={isValidConnection}
            connectionLineComponent={MapConnectionLine}
            zoomOnDoubleClick={false}
            onPaneClick={() => {
              setSelectedId(null)
              setSelectedDraftEdgeId(null)
              setContextTargetId(null)
              setPicker(null)
            }}
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement
              if (target.classList.contains('react-flow__pane')) {
                openPicker(event.clientX, event.clientY)
              }
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              rememberContextPosition(event)
              if (node.type === 'scene' || node.type === 'draft') {
                setPicker(null)
                setSelectedDraftEdgeId(null)
                setContextTargetId(node.type === 'scene' ? node.id : null)
                setNodeMenu({ x: event.clientX, y: event.clientY, target: node.type, id: node.id })
              }
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault()
              if (draftEdges.some((draftEdge) => draftEdge.id === edge.id)) {
                setPicker(null)
                setSelectedDraftEdgeId(edge.id)
                setNodeMenu({ x: event.clientX, y: event.clientY, target: 'edge', id: edge.id })
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
              setPicker(null)
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
                    [node.id]: { ...(pin?.nodes[node.id] ?? {}), x: node.position.x, y: node.position.y },
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
              background: 'var(--background)',
            }}
          >
            {/* bgColor transparent: React Flow otherwise paints its own darker default
                canvas colour, which made the toolbar row read as a separate band. */}
            <Background gap={24} size={1} bgColor="transparent" color="color-mix(in oklch, var(--foreground) 8%, transparent)" />
            {!mapEmpty ? (
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                bgColor="transparent"
                className="rox-map-minimap !rounded-lg !border-0 !bg-foreground/[0.04] !shadow-none"
                maskColor="rgba(15, 16, 20, 0.18)"
                nodeColor="rgba(255, 255, 255, 0.22)"
              />
            ) : null}
          </ReactFlow>

          {/* Visible node creation: «+» (bottom-left) and double-click open the same type picker. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="map-add-node"
            aria-label={t('entityView.mapAddNode')}
            title={t('entityView.mapAddNodeHint')}
            className="absolute bottom-3 left-3 z-10 h-8 gap-1 rounded-md bg-foreground/[0.06] px-2.5 text-[11px] text-foreground hover:bg-foreground/10"
            onClick={openPickerFromPlus}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('entityView.mapAddNodeShort')}
          </Button>

          {picker ? (
            <div
              role="menu"
              aria-label={t('entityView.mapAddNode')}
              data-testid="map-node-picker"
              className="absolute z-20 w-52 rounded-lg bg-popover p-1 text-popover-foreground shadow-strong"
              style={{ left: picker.left, top: picker.top }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setPicker(null)
                }
              }}
            >
              <div className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {t('entityView.mapAddNode')}
              </div>
              {[...MAP_PICKER_PRIMARY, ...(pickerMore ? MAP_PICKER_MORE : [])].map((item, index) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    autoFocus={index === 0}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] focus-visible:outline-none"
                    onClick={() => pickNodeType(item)}
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {t(item.labelKey)}
                  </button>
                )
              })}
              {!pickerMore ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-foreground/[0.06]"
                  onClick={() => setPickerMore(true)}
                >
                  {t('entityView.mapAddNodeMore')}
                </button>
              ) : null}
            </div>
          ) : null}
          </div>

          {inspectorOpen ? (
            <aside
              data-testid="session-canvas-inspector"
              aria-label={t('entityView.mapInspector')}
              className="relative z-10 flex w-72 shrink-0 flex-col gap-3 overflow-y-auto bg-foreground/[0.03] p-3"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {selected ? selectedKindLabel : selectedDraft ? t(SESSION_NODE_KIND_I18N[selectedDraft.kind]) : ''}
                </span>
                {selectedStatus ? (
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t(`entityView.mapStatus.${selectedStatus}`)}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                  aria-label={t('common.close')}
                  title={t('entityView.mapInspectorClose')}
                  onClick={closeInspector}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {selected ? (
                <>
                  <div className="line-clamp-3 break-words text-xs font-medium leading-4 text-foreground">
                    {selected.triggerPreview || selected.id}
                  </div>
                  <label className="text-[11px] text-muted-foreground" htmlFor="session-map-compose">
                    {t('entityView.mapComposeLabel')}
                  </label>
                  <textarea
                    id="session-map-compose"
                    className="min-h-[96px] w-full resize-y rounded-md bg-foreground/[0.04] px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.06]"
                    placeholder={t('entityView.mapComposePlaceholder')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        rewriteScene(selected, draft)
                      }
                    }}
                  />
                  {selectedContextNotes.length > 0 ? (
                    <div className="flex flex-col gap-1 rounded-md bg-amber-400/[0.06] px-2 py-1.5" data-testid="map-inspector-context-notes">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {t('entityView.mapContextNotesTitle', { n: selectedContextNotes.length })}
                      </div>
                      {selectedContextNotes.map((note, index) => (
                        <div key={index} className="line-clamp-2 text-[11px] text-foreground/90">{note}</div>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-md text-[11px]"
                    disabled={!draft.trim()}
                    onClick={() => rewriteScene(selected, draft)}
                  >
                    {t('entityView.workbenchRewriteBranch')}
                  </Button>
                  <p className="text-[10px] leading-4 text-muted-foreground">{t('entityView.mapRewriteHint')}</p>
                  <div className="flex flex-col">
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => onFork?.(selected.triggerMessageId)}>
                      <GitBranch className="h-3.5 w-3.5" />
                      {t('entityView.workbenchFork')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => setFanOutOpen(true)}>
                      <Split className="h-3.5 w-3.5" />
                      {t('entityView.fanOutShort')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => attachNoteToScene(selected.id)}>
                      <StickyNote className="h-3.5 w-3.5" />
                      {t('entityView.mapAttachNote')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => onOpenMessage?.(selected.triggerMessageId)}>
                      <FileText className="h-3.5 w-3.5" />
                      {t('entityView.mapOpenInChat')}
                    </Button>
                  </div>
                </>
              ) : null}

              {selectedDraft ? (
                <>
                  {selectedDraftAnchor ? (
                    <div className="min-w-0 truncate text-[11px] text-muted-foreground" title={selectedDraftAnchor}>
                      ↳ {selectedDraftAnchor}
                    </div>
                  ) : null}
                  <textarea
                    aria-label={t('entityView.mapComposeLabel')}
                    className="min-h-[96px] w-full resize-y rounded-md bg-foreground/[0.04] px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.06]"
                    placeholder={t(SESSION_DRAFT_PROMPT_I18N[selectedDraft.kind])}
                    value={selectedDraft.title}
                    onChange={(event) => updateDraftTitle(selectedDraft.id, event.target.value)}
                  />
                  <p className="text-[10px] leading-4 text-muted-foreground">{t('entityView.mapEdgeLegend')}</p>
                  <div className="flex flex-col">
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => handleRun('node')}>
                      {t('entityView.mapRunNode')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className={inspectorButton} onClick={() => handleRun('from-here')}>
                      {t('entityView.mapRunFromHere')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" size="sm" variant="ghost" className={inspectorButton}>
                          {t('entityView.mapConvertNode')}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[12rem]">
                        {SESSION_NODE_KINDS.map((kind) => (
                          <DropdownMenuItem key={kind} onClick={() => handleConvert(kind)}>
                            {t(SESSION_NODE_KIND_I18N[kind])}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={cn(inspectorButton, 'text-destructive hover:text-destructive')}
                      onClick={() => deleteDraftNode(selectedDraft.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('entityView.mapDeleteDraftNode')}
                    </Button>
                  </div>
                </>
              ) : null}
            </aside>
          ) : null}
          </div>

          {/* Node-only context menu, anchored at the cursor. */}
          <DropdownMenu open={nodeMenu !== null} onOpenChange={(open) => { if (!open) setNodeMenu(null) }}>
            <DropdownMenuTrigger asChild>
              <span
                aria-hidden
                className="pointer-events-none fixed h-0 w-0"
                style={{ left: nodeMenu?.x ?? 0, top: nodeMenu?.y ?? 0 }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]" data-testid="map-node-menu">
              {menuScene ? (
                <>
                  <DropdownMenuItem onClick={() => { setSelectedId(menuScene.id); setContextTargetId(menuScene.id) }}>
                    {t('entityView.mapOpenInspector')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenMessage?.(menuScene.triggerMessageId)}>
                    {t('entityView.mapOpenInChat')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSelectedId(menuScene.id); setContextTargetId(menuScene.id) }}>
                    {t('entityView.workbenchRewriteBranch')}…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onFork?.(menuScene.triggerMessageId)}>
                    {t('entityView.workbenchFork')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => attachNoteToScene(menuScene.id)}>
                    {t('entityView.mapAttachNote')}
                  </DropdownMenuItem>
                </>
              ) : null}
              {menuDraft ? (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{t('entityView.mapConvertNode')}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[12rem]">
                      {SESSION_NODE_KINDS.map((kind) => (
                        <DropdownMenuItem key={kind} onClick={() => { setSelectedId(menuDraft.id); handleConvert(kind) }}>
                          {t(SESSION_NODE_KIND_I18N[kind])}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => handleRun('node')}>
                    {t('entityView.mapRunNode')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRun('from-here')}>
                    {t('entityView.mapRunFromHere')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRun('selection')}>
                    {t('entityView.mapRunSelection')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleReplay}>
                    {t('entityView.mapReplayRun')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => deleteDraftNode(menuDraft.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('entityView.mapDeleteDraftNode')}
                  </DropdownMenuItem>
                </>
              ) : null}
              {nodeMenu?.target === 'edge' ? (
                <DropdownMenuItem className="text-destructive" onClick={() => deleteDraftEdge(nodeMenu.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('entityView.mapDeleteConnection')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* «Рассылка» opens only from the inspector. */}
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
