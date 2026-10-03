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
  useNodesInitialized,
  useUpdateNodeInternals,
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
} from '@rox/core/mindmap'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
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
  STICKY_COLORS,
  type SessionDraftGraph,
  type SessionDraftNode,
  type StickyColor,
} from './draft-nodes'
import { deriveSessionNodeKind, SESSION_NODE_KINDS, type SessionNodeKind } from './node-kinds'
import {
  alignBoxes,
  distributeBoxes,
  keyboardConnectTarget,
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
  draftMinimumSize,
  draftNodesWithSize,
  nodeBox,
  pinWithSceneSize,
  type NodeSize,
} from './map-node-size'
import { shortSceneTitle } from './scene-tools'
import { canvasCenter, canvasMenuPosition, centeredNodePosition, isCanvasTextInput, menuFocusIndex, nearestFreeNodePosition } from './canvas-interactions'
import { draftGraphToSpec, loadWorkflowDocument, persistWorkflowDocument, specToDraftGraph } from './workflow-document'
import { convertDraftGraphNode, reconcileCanvasNodes } from './canvas-node-editing'
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
  isProductionWorkflowSuccess,
  type WorkflowRun,
} from '@rox/shared/workflows'

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

const STICKY_COLOR_CLASSES: Record<StickyColor, string> = {
  amber: 'bg-amber-300/20 border-amber-400/25',
  blue: 'bg-sky-300/20 border-sky-400/25',
  green: 'bg-emerald-300/20 border-emerald-400/25',
  rose: 'bg-rose-300/20 border-rose-400/25',
  violet: 'bg-violet-300/20 border-violet-400/25',
}

const STICKY_COLOR_I18N: Record<StickyColor, string> = {
  amber: 'entityView.mapStickyColorAmber',
  blue: 'entityView.mapStickyColorBlue',
  green: 'entityView.mapStickyColorGreen',
  rose: 'entityView.mapStickyColorRose',
  violet: 'entityView.mapStickyColorViolet',
}

const DRAFT_KIND_TONES: Partial<Record<SessionNodeKind, string>> = {
  model: 'text-violet-500 dark:text-violet-300',
  tool: 'text-sky-600 dark:text-sky-300',
  memory: 'text-fuchsia-500 dark:text-fuchsia-300',
  condition: 'text-amber-600 dark:text-amber-300',
  output: 'text-emerald-600 dark:text-emerald-300',
}

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
  return t(`entityView.mapRunStatus.${status}`)
}

function DraftNode({ id, data, selected }: NodeProps<Node<DraftNodeData, 'draft'>>) {
  const { t } = useTranslation()
  const updateNodeInternals = useUpdateNodeInternals()
  const Icon = data.draft.role === 'sticky' ? StickyNote : DRAFT_NODE_ICONS[data.draft.kind]
  const role = data.draft.role ?? 'node'
  const annotation = role === 'frame' || role === 'group' || data.draft.kind === 'annotation_frame'
  const minSize = draftMinimumSize(role)
  React.useLayoutEffect(() => {
    // Conversion changes the actual port DOM without changing the outer
    // React Flow node type or its box. Refresh cached handle coordinates.
    updateNodeInternals(id)
  }, [id, data.draft.kind, role, updateNodeInternals])
  return (
    <div
      data-role={role}
      className={cn(
        // Flat surfaces, no nested outlines; selection is one accent ring.
        'group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg p-2 text-left',
        role === 'sticky' && ['border shadow-xs backdrop-blur-md', STICKY_COLOR_CLASSES[data.draft.color ?? 'amber']],
        role === 'frame' && 'border border-dashed border-foreground/20 bg-foreground/[0.02]',
        role === 'group' && 'bg-violet-400/[0.06]',
        role === 'node' && 'bg-foreground/[0.05]',
        selected && 'ring-2 ring-accent',
      )}
    >
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={minSize.width}
        minHeight={minSize.height}
        lineClassName="!border-accent/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-0 !bg-accent"
        onResizeEnd={(_event, box) => data.onResize(id, box)}
      />
      {!annotation ? <Handle type="target" position={Position.Left} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-foreground/40" /> : null}
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', DRAFT_KIND_TONES[data.draft.kind])} />
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
        aria-label={data.kindLabel}
        className={cn('nodrag nowheel w-full resize-none rounded-md bg-transparent px-1 py-1 text-xs leading-4 outline-none placeholder:text-muted-foreground/50 focus:bg-foreground/[0.04]', annotation ? 'h-8 min-h-8' : 'min-h-[48px] flex-1')}
        value={data.draft.title}
        placeholder={data.placeholder}
        onChange={(event) => data.onChangeTitle(data.draft.id, event.target.value)}
      />
      {!annotation && data.draft.kind !== 'output' ? (
        data.draft.kind === 'condition' ? (
          <>
            <Handle id={`${id}:true`} type="source" position={Position.Right} style={{ top: '40%' }} title={t('entityView.mapPortTrue')} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-emerald-400" />
            <Handle id={`${id}:false`} type="source" position={Position.Right} style={{ top: '75%' }} title={t('entityView.mapPortFalse')} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-rose-400" />
            <span className="pointer-events-none absolute right-3 top-[33%] text-[9px] text-emerald-600 dark:text-emerald-300">{t('entityView.mapPortTrue')}</span>
            <span className="pointer-events-none absolute right-3 top-[68%] text-[9px] text-rose-600 dark:text-rose-300">{t('entityView.mapPortFalse')}</span>
          </>
        ) : <Handle type="source" position={Position.Right} className="rox-map-handle !h-2.5 !w-2.5 !border-0 !bg-foreground/40" />
      ) : null}
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
  const pendingPinRef = React.useRef<SessionMapPin | null>(null)
  const flushPendingPin = React.useCallback(() => {
    const pending = pendingPinRef.current
    if (!pending) return
    pendingPinRef.current = null
    try {
      localStorage.setItem(sessionMapPinStorageKey(pending.sessionId), serializeSessionMapPin(pending))
    } catch {
      /* ignore quota */
    }
  }, [])
  const flowRef = React.useRef<ReactFlowInstance | null>(null)
  const [flowReady, setFlowReady] = React.useState(false)
  const nodesInitialized = useNodesInitialized()
  const initialFitDoneRef = React.useRef(Boolean(loadPin(sessionId)?.viewport))
  /** Mini-map is opt-in (⋯ menu): hidden by default. */
  const [showMinimap, setShowMinimap] = React.useState(false)
  // Re-fit the viewport whenever the camera (Карта ↔ Поток) changes, so the
  // re-laid-out nodes never land off screen.
  const lastFitCameraRef = React.useRef<SessionMapCamera | null>(null)
  React.useEffect(() => {
    if (lastFitCameraRef.current === null) {
      lastFitCameraRef.current = camera
      return
    }
    if (lastFitCameraRef.current === camera) return
    lastFitCameraRef.current = camera
    const timer = window.setTimeout(() => {
      flowRef.current?.fitView({ padding: 0.2, duration: 200 })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [camera])
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
  const creationPlacementRef = React.useRef<'point' | 'center'>('center')
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
    setPicker(null)
    setNodeMenu(null)
    initialFitDoneRef.current = Boolean(next?.viewport)
  }, [sessionId])

  React.useEffect(() => {
    return () => {
      window.clearTimeout(persistTimer.current)
      flushPendingPin()
    }
  }, [flushPendingPin])

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
          height: size.height,
          zIndex: draftNode.role === 'frame' || draftNode.role === 'group' ? -1 : 1,
          data: {
            draft: draftNode,
            kindLabel: t(draftNode.role === 'sticky' ? 'entityView.mapSticky' : draftNode.role === 'group' ? 'entityView.mapGroup' : SESSION_NODE_KIND_I18N[draftNode.kind]),
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
  React.useEffect(() => {
    if (initialFitDoneRef.current || !flowReady || !nodesInitialized || nodes.length === 0 || !flowRef.current) return
    initialFitDoneRef.current = true
    void flowRef.current.fitView({ padding: 0.2 })
  }, [flowReady, nodesInitialized, nodes.length])
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
    setNodes((previous) => reconcileCanvasNodes(flowSeedNodes, previous, selectedId))
    // Keep pin positions; toFlowElements already applied pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection applied via selectedId separately
  }, [projectedKey, graph, pin, camera, flowSeedNodes])


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
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          data: { kind: kind === 'context' ? 'context' : 'draft' },
          selected: edge.id === selectedDraftEdgeId,
          // Every user-drawn edge says what it means: workflow step or context link.
          label: kind === 'context' ? t('entityView.mapEdgeContext') : edge.sourceHandle?.endsWith(':true') ? t('entityView.mapPortTrue') : edge.sourceHandle?.endsWith(':false') ? t('entityView.mapPortFalse') : t('entityView.mapEdgeStep'),
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
      pendingPinRef.current = next
      window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(flushPendingPin, 250)
    },
    [flushPendingPin],
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
    (connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) =>
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
      const next = createSessionDraftEdge(verdict)
      persistDraftGraph({ nodes: draftNodes, edges: [...draftEdges, next] })
    },
    [draftEdges, draftNodes, persistDraftGraph, t, verdictFor],
  )

  const rememberContextPosition = React.useCallback((event: MouseEvent | React.MouseEvent) => {
    const next = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (next) {
      contextPositionRef.current = next
      hasContextPositionRef.current = true
      creationPlacementRef.current = 'point'
    }
  }, [])

  const newNodePosition = React.useCallback((role: SessionDraftNode['role']) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const point = hasContextPositionRef.current
      ? contextPositionRef.current
      : rect ? flowRef.current?.screenToFlowPosition(canvasCenter(rect)) : undefined
    const size = defaultDraftSize(role)
    const center = point ?? { x: 160, y: 100 }
    if (!rect || !flowRef.current || role === 'frame' || role === 'group' || (hasContextPositionRef.current && creationPlacementRef.current === 'point')) {
      return centeredNodePosition(center, size)
    }
    const start = flowRef.current.screenToFlowPosition({ x: rect.left + 12, y: rect.top + 12 })
    const end = flowRef.current.screenToFlowPosition({ x: rect.left + rect.width - 12, y: rect.top + rect.height - 12 })
    const occupied = nodes
      .filter((node) => !isDraftFlowNode(node) || (node.data.draft.kind !== 'annotation_frame' && node.data.draft.role !== 'frame' && node.data.draft.role !== 'group'))
      .map((node) => nodeBox(node, isDraftFlowNode(node) ? defaultDraftSize(node.data.draft.role) : undefined))
    return nearestFreeNodePosition(center, size, occupied, { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y })
  }, [nodes])

  const handleCreateNode = React.useCallback(
    (kind: SessionNodeKind) => {
      const position = newNodePosition(kind === 'annotation_frame' ? 'frame' : 'node')
      if (!position) {
        toast.message(t('entityView.mapNoFreeSpace'))
        return
      }
      const next = createSessionDraftNode({
        kind,
        position,
        title: '',
        ...(kind === 'annotation_frame' ? { role: 'frame' as const } : {}),
      })
      initialFitDoneRef.current = true
      persistDraftGraph({ nodes: [...draftNodes, next], edges: draftEdges })
      setNodes((previous) => previous.map((node) => ({ ...node, selected: false })))
      setSelectedId(next.id)
      hasContextPositionRef.current = false
    },
    [draftEdges, draftNodes, newNodePosition, persistDraftGraph, t],
  )

  const handleCreateChrome = React.useCallback(
    (role: 'sticky' | 'frame' | 'group') => {
      const position = newNodePosition(role)
      if (!position) {
        toast.message(t('entityView.mapNoFreeSpace'))
        return
      }
      const next = createSessionDraftNode({
        kind: role === 'sticky' ? 'note' : 'annotation_frame',
        position,
        title: '',
        role,
      })
      initialFitDoneRef.current = true
      persistDraftGraph({ nodes: [...draftNodes, next], edges: draftEdges })
      setNodes((previous) => previous.map((node) => ({ ...node, selected: false })))
      setSelectedId(next.id)
      hasContextPositionRef.current = false
    },
    [draftEdges, draftNodes, newNodePosition, persistDraftGraph, t],
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
    (mode: 'node' | 'from-here' | 'selection' | 'pipeline', targetId = selectedId) => {
      try {
        let document = { ...workflowDoc, draft: currentSpec() }
        document = saveVersion(document)
        const spec = document.versions[document.versions.length - 1] ?? document.draft
        const seedIds =
          mode === 'pipeline'
            ? []
            : mode === 'selection'
              ? nodes.filter((node) => node.selected).map((node) => node.id)
              : targetId
                ? [targetId]
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
      description: t('entityView.mapVersionDiff', { added: diff.addedNodes.length, removed: diff.removedNodes.length }),
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
    (kind: SessionNodeKind, targetId = selectedId) => {
      if (!targetId || !draftNodes.some((node) => node.id === targetId)) return
      persistDraftGraph(convertDraftGraphNode({ v: 1, sessionId, nodes: draftNodes, edges: draftEdges }, targetId, kind))
    },
    [draftEdges, draftNodes, persistDraftGraph, selectedId, sessionId],
  )

  const selected = graph.scenes.find((s) => s.id === selectedId) ?? null
  const mapEmpty = isSessionMapEmpty({ scenes: graph.scenes, draftNodes })
  const selectedDraft = draftNodes.find((node) => node.id === selectedId) ?? null

  const resetLayout = () => {
    window.clearTimeout(persistTimer.current)
    pendingPinRef.current = null
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
    setNodes((previous) => previous.map((node) => ({ ...node, selected: false })))
  }, [])

  const openPicker = React.useCallback((clientX: number, clientY: number, flowPosition?: { x: number; y: number }, placement: 'point' | 'center' = 'point') => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = flowPosition ?? flowRef.current?.screenToFlowPosition({ x: clientX, y: clientY })
    if (position) {
      contextPositionRef.current = position
      hasContextPositionRef.current = true
    }
    creationPlacementRef.current = placement
    setNodeMenu(null)
    setPickerMore(false)
    setPicker(canvasMenuPosition({ x: clientX, y: clientY }, rect, { width: 208, height: 320 }))
  }, [])

  const openPickerFromPlus = React.useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const center = flowRef.current?.screenToFlowPosition(canvasCenter(rect))
    openPicker(rect.left + 12, rect.top + rect.height - 332, center, 'center')
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

  const changeStickyColor = (id: string, color: StickyColor) => {
    persistDraftGraph({ nodes: draftNodes.map((node) => node.id === id ? { ...node, color } : node), edges: draftEdges })
  }

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
            if (isCanvasTextInput(event.target)) return
            if ((event.key === 'Delete' || event.key === 'Backspace') &&
                event.target instanceof Element && canvasRef.current?.contains(event.target) &&
                !event.target.closest('button, [role="menu"]')) {
              const deleted = new Set(nodes.filter((node) => node.selected && isDraftFlowNode(node)).map((node) => node.id))
              if (deleted.size > 0 || selectedDraftEdgeId) {
                event.preventDefault()
                event.stopPropagation()
                persistDraftGraph({
                  nodes: draftNodes.filter((node) => !deleted.has(node.id)),
                  edges: draftEdges.filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target) && edge.id !== selectedDraftEdgeId),
                })
                if (selectedId && deleted.has(selectedId)) setSelectedId(null)
                setSelectedDraftEdgeId(null)
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
            const boxes = nodes.filter((node) => node.id === selectedId || verdictFor({ source: selectedId, target: node.id }).ok).map((node) => boxOf(node))
            const target = keyboardConnectTarget(selectedId, direction, boxes)
            if (!target) return
            const verdict = verdictFor({ source: selectedId, target })
            if (verdict.ok) {
              const next = createSessionDraftEdge(verdict)
              persistDraftGraph({ nodes: draftNodes, edges: [...draftEdges, next] })
            }
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 cursor-default rounded-full bg-foreground/[0.05] px-2 py-1 text-muted-foreground">
                      {t('entityView.flowLive')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px]">{t('entityView.flowLiveHint')}</TooltipContent>
                </Tooltip>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrapper keeps the tooltip alive while the button is disabled. */}
                  <span className="inline-flex" tabIndex={selected ? -1 : 0}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      data-testid="map-toolbar-rewrite-node"
                      className="map-toolbar-btn h-7 rounded-md px-2.5 text-[11px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                      disabled={!selected}
                      onClick={() => rewriteSelected(draft.trim() || selected?.triggerPreview || '')}
                    >
                      {t('entityView.mapRewriteNode')}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px]">
                  {selected ? t('entityView.mapRewriteNodeHint') : t('entityView.mapRewriteNodeDisabled')}
                </TooltipContent>
              </Tooltip>
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
                      <DropdownMenuItem data-testid="map-toolbar-menu-minimap" onClick={() => setShowMinimap((v) => !v)}>
                        {showMinimap ? t('entityView.mapHideMinimap') : t('entityView.mapShowMinimap')}
                      </DropdownMenuItem>
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
            elevateNodesOnSelect={false}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Strict}
            isValidConnection={isValidConnection}
            connectionLineComponent={MapConnectionLine}
            zoomOnDoubleClick={false}
            onPaneClick={() => {
              setSelectedId(null)
              setSelectedDraftEdgeId(null)
              setPicker(null)
              setNodeMenu(null)
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              openPicker(event.clientX, event.clientY)
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
                setSelectedId(node.id)
                setNodes((previous) => previous.map((item) => ({ ...item, selected: item.id === node.id })))
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
            onMoveStart={(event) => { if (event) initialFitDoneRef.current = true }}
            onNodeDragStop={(_e, node, draggedNodes) => {
              const moved = draggedNodes.length > 0 ? draggedNodes : [node]
              const draftPositions = new Map(moved.filter(isDraftFlowNode).map((item) => [item.id, item.position]))
              if (draftPositions.size > 0) {
                persistDraftGraph({
                  nodes: draftNodes.map((draftNode) => {
                    const position = draftPositions.get(draftNode.id)
                    return position ? { ...draftNode, position: { x: position.x, y: position.y } } : draftNode
                  }),
                  edges: draftEdges,
                })
              }
              const movedScenes = moved.filter((item) => item.type === 'scene')
              if (movedScenes.length > 0) {
                persistPin({
                  v: 1,
                  sessionId,
                  camera,
                  ...(viewportRef.current ? { viewport: viewportRef.current } : {}),
                  nodes: {
                    ...(pin?.nodes ?? {}),
                    ...Object.fromEntries(movedScenes.map((item) => [item.id, {
                      ...(pin?.nodes[item.id] ?? {}), x: item.position.x, y: item.position.y,
                    }])),
                  },
                })
              }
            }}
            onInit={(inst) => {
              flowRef.current = inst
              setFlowReady(true)
              if (pin?.viewport) inst.setViewport(pin.viewport)
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
            {!mapEmpty && showMinimap ? (
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
              className="absolute z-20 w-52 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl border border-border/40 bg-popover/95 p-1 text-popover-foreground shadow-strong backdrop-blur-xl"
              style={{ left: picker.left, top: picker.top }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setPicker(null)
                  return
                }
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
                const next = menuFocusIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)
                if (next === null) return
                event.preventDefault()
                event.stopPropagation()
                items[next]?.focus()
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
              className={cn('absolute z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border/40 bg-background/90 p-3 shadow-strong backdrop-blur-xl', toolbarWidth !== null && toolbarWidth < 640 ? 'bottom-3 left-3 right-3 max-h-[40%]' : 'bottom-3 right-3 top-3 w-72')}
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
                  {selectedDraft.role === 'sticky' ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] text-muted-foreground">{t('entityView.mapStickyColor')}</span>
                      <div role="group" aria-label={t('entityView.mapStickyColor')} className="flex gap-2">
                        {STICKY_COLORS.map((color) => (
                          <button key={color} type="button" aria-label={t(STICKY_COLOR_I18N[color])} title={t(STICKY_COLOR_I18N[color])} aria-pressed={(selectedDraft.color ?? 'amber') === color} className={cn('h-7 w-7 rounded-full border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', STICKY_COLOR_CLASSES[color], (selectedDraft.color ?? 'amber') === color && 'ring-2 ring-accent')} onClick={() => changeStickyColor(selectedDraft.id, color)} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col">
                    {selectedDraft.kind !== 'annotation_frame' ? <>
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
                    </> : null}
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
                  <DropdownMenuItem onClick={() => { setSelectedId(menuScene.id) }}>
                    {t('entityView.mapOpenInspector')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenMessage?.(menuScene.triggerMessageId)}>
                    {t('entityView.mapOpenInChat')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSelectedId(menuScene.id) }}>
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
                        <DropdownMenuItem key={kind} onClick={() => handleConvert(kind, menuDraft.id)}>
                          {t(SESSION_NODE_KIND_I18N[kind])}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {menuDraft.kind !== 'annotation_frame' ? <>
                  <DropdownMenuItem onClick={() => handleRun('node', menuDraft.id)}>
                    {t('entityView.mapRunNode')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRun('from-here', menuDraft.id)}>
                    {t('entityView.mapRunFromHere')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRun('selection')}>
                    {t('entityView.mapRunSelection')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleReplay}>
                    {t('entityView.mapReplayRun')}
                  </DropdownMenuItem>
                  </> : null}
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
    <ReactFlowProvider key={props.sessionId}>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}
