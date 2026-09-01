import * as React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import { BrainCircuit, Database, GitBranch, StickyNote, Wrench } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import '../index.css'

type PreviewKind = 'note' | 'model' | 'tool' | 'memory'

type PreviewNodeData = {
  kind: PreviewKind
  title: string
  detail: string
  status: 'done' | 'running' | 'waiting'
} & Record<string, unknown>

type PreviewNode = Node<PreviewNodeData, 'preview'>

const KIND_META: Record<PreviewKind, {
  label: string
  color: string
  icon: React.ComponentType<{ className?: string }>
  detail: string
}> = {
  note: {
    label: 'Note',
    color: '#8b8f98',
    icon: StickyNote,
    detail: 'Human annotation, intent, acceptance notes.',
  },
  model: {
    label: 'Model inference',
    color: '#a78bfa',
    icon: BrainCircuit,
    detail: 'Prompt, model, schema, reproducible parameters.',
  },
  tool: {
    label: 'Tool inference',
    color: '#f59e0b',
    icon: Wrench,
    detail: 'Capability call with typed inputs and outputs.',
  },
  memory: {
    label: 'Memory',
    color: '#10b981',
    icon: Database,
    detail: 'Recall or write policy with provenance.',
  },
}

const initialNodes: PreviewNode[] = [
  {
    id: 'intent',
    type: 'preview',
    position: { x: 120, y: 160 },
    data: {
      kind: 'note',
      title: 'Session intent',
      detail: 'Represent the session as an editable pipeline draft.',
      status: 'done',
    },
  },
  {
    id: 'plan',
    type: 'preview',
    position: { x: 470, y: 110 },
    data: {
      kind: 'model',
      title: 'Plan synthesis',
      detail: 'Generate a typed WorkflowSpec candidate.',
      status: 'done',
    },
  },
  {
    id: 'tool',
    type: 'preview',
    position: { x: 830, y: 210 },
    data: {
      kind: 'tool',
      title: 'Repository check',
      detail: 'Run bounded diagnostics and attach evidence.',
      status: 'running',
    },
  },
  {
    id: 'memory',
    type: 'preview',
    position: { x: 470, y: 360 },
    data: {
      kind: 'memory',
      title: 'Context recall',
      detail: 'Read only relevant prior decisions.',
      status: 'waiting',
    },
  },
]

const initialEdges: Edge[] = [
  {
    id: 'intent-plan',
    source: 'intent',
    target: 'plan',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'rgb(120 116 136 / 0.52)', strokeWidth: 1.4 },
  },
  {
    id: 'plan-tool',
    source: 'plan',
    target: 'tool',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'rgb(120 116 136 / 0.52)', strokeWidth: 1.4 },
  },
  {
    id: 'intent-memory',
    source: 'intent',
    target: 'memory',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'rgb(120 116 136 / 0.38)', strokeWidth: 1.2 },
  },
]

function PreviewNodeCard({ data, selected }: NodeProps<PreviewNode>) {
  const meta = KIND_META[data.kind]
  const Icon = meta.icon
  const statusLabel = data.status === 'running' ? 'Sample running' : data.status === 'waiting' ? 'Sample waiting' : 'Sample done'

  return (
    <div
      className={[
        'w-[292px] rounded-lg border bg-background/88 p-3 text-foreground shadow-minimal backdrop-blur-xl',
        selected ? 'border-accent/70' : 'border-foreground/10',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-background !bg-foreground/35" />
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5"
          style={{ color: meta.color }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold leading-5">{data.title}</p>
            <span
              className="shrink-0 rounded-full border border-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-normal text-foreground/60"
              style={{ color: meta.color }}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground/48">{meta.label}</p>
          <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-foreground/68">{data.detail}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-background !bg-foreground/35" />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  preview: PreviewNodeCard as React.ComponentType<NodeProps>,
}

function BrowserCanvasPreview() {
  const [nodes, setNodes] = React.useState<PreviewNode[]>(initialNodes)
  const [edges, setEdges] = React.useState<Edge[]>(initialEdges)
  const [menu, setMenu] = React.useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null)
  const canvasRef = React.useRef<HTMLDivElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const { screenToFlowPosition } = useReactFlow()

  const onNodesChange = React.useCallback((changes: NodeChange<PreviewNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  const onEdgesChange = React.useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
  }, [])

  const onConnect = React.useCallback((connection: Connection) => {
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: 'rgb(120 116 136 / 0.52)', strokeWidth: 1.4 },
        },
        current,
      ),
    )
  }, [])

  const openMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const rect = canvasRef.current?.getBoundingClientRect()
    setMenu({
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
      flowX: point.x,
      flowY: point.y,
    })
  }, [screenToFlowPosition])

  const createNode = React.useCallback((kind: PreviewKind) => {
    if (!menu) return
    const meta = KIND_META[kind]
    setNodes((current) => [
      ...current,
      {
        id: `${kind}-${current.length + 1}`,
        type: 'preview',
        position: { x: menu.flowX, y: menu.flowY },
        data: {
          kind,
          title: meta.label,
          detail: meta.detail,
          status: 'waiting',
        },
      },
    ])
    setMenu(null)
  }, [menu])

  const resetSample = React.useCallback(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    setMenu(null)
  }, [])

  React.useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [])

  React.useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [menu])

  const moveMenuFocus = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Escape') {
      setMenu(null)
      return
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    if (items.length === 0) return
    const activeIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (activeIndex + 1) % items.length
            : (activeIndex - 1 + items.length) % items.length
    items[nextIndex]?.focus()
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(167,139,250,0.14),transparent_34%),radial-gradient(circle_at_82%_74%,rgba(16,185,129,0.12),transparent_30%)]" />
      <div className="absolute inset-0 bg-foreground/[0.015]" />
      <div className="absolute left-5 top-5 z-10 flex items-center gap-3 rounded-lg border border-foreground/10 bg-background/78 px-3 py-2 shadow-minimal backdrop-blur-xl">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground/6 text-accent">
          <GitBranch className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[13px] font-semibold leading-4">Sample canvas — no live session data</p>
          <p className="text-[11px] leading-4 text-foreground/55">Browser preview; Electron-only surfaces disabled</p>
        </div>
        <button
          className="ml-2 h-7 rounded-md border border-foreground/10 px-2 text-[11px] text-foreground/60 hover:bg-foreground/6 focus:outline-none focus:ring-1 focus:ring-accent/50"
          onClick={resetSample}
        >
          Reset sample
        </button>
      </div>
      <div ref={canvasRef} className="relative h-full w-full" onContextMenu={openMenu}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          minZoom={0.35}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="rgb(120 116 136 / 0.18)" />
          <Controls className="!border-foreground/10 !bg-background/70 !shadow-minimal !backdrop-blur-xl" />
          <MiniMap
            className="!rounded-lg !border !border-foreground/10 !bg-background/46 !shadow-minimal !backdrop-blur-xl"
            maskColor="rgb(10 10 14 / 0.16)"
            nodeColor={(node) => KIND_META[(node.data as PreviewNodeData).kind]?.color ?? '#8b8f98'}
            nodeStrokeWidth={3}
            pannable
            zoomable
          />
        </ReactFlow>
        {menu ? (
          <div
            ref={menuRef}
            className="absolute z-20 w-[244px] rounded-lg border border-foreground/10 bg-background/92 p-1.5 shadow-modal-small backdrop-blur-xl"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            aria-label="Sample node types"
            onKeyDown={moveMenuFocus}
            onClick={(event) => event.stopPropagation()}
          >
            {(Object.keys(KIND_META) as PreviewKind[]).map((kind) => {
              const meta = KIND_META[kind]
              const Icon = meta.icon
              return (
                <button
                  key={kind}
                  className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-foreground/6"
                  role="menuitem"
                  onClick={() => createNode(kind)}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/5"
                    style={{ color: meta.color }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium leading-4">{meta.label}</span>
                    <span className="block truncate text-[11px] leading-4 text-foreground/50">{meta.detail}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function renderBrowserPreview() {
  const root = document.getElementById('root')
  if (!root) return

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ReactFlowProvider>
        <BrowserCanvasPreview />
      </ReactFlowProvider>
    </React.StrictMode>,
  )
}
