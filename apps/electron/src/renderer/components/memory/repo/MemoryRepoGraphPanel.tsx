/**
 * Память → Репозиторий → Граф.
 *
 * `@xyflow/react` canvas over the frozen `MemoryRepoGraph` DTO: lesson/topic/
 * context/session/note/file nodes, cluster/provenance/wikilink edges. A node
 * carries the repo file path; clicking it opens that file. Pure props.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Network } from 'lucide-react'
import type { MemoryRepoGraph } from '@rox/shared/memory/repo'
import { cn } from '@/lib/utils'

export interface MemoryRepoGraphPanelProps {
  graph: MemoryRepoGraph | null
  onOpenFile(path: string): void
}

export interface MemoryGraphNodeData extends Record<string, unknown> {
  label: string
  kind: MemoryRepoGraph['nodes'][number]['kind']
  path?: string
}

export type MemoryGraphFlowNode = Node<MemoryGraphNodeData, 'memoryNode'>

const KIND_TONE: Record<MemoryRepoGraph['nodes'][number]['kind'], string> = {
  lesson: 'border-accent/40 bg-accent/12 text-accent',
  topic: 'border-success/40 bg-success/12 text-success',
  context: 'border-status-warning/40 bg-status-warning/12 text-status-warning',
  session: 'border-border-strong bg-foreground-10 text-text-secondary',
  note: 'border-accent/25 bg-accent/10 text-accent',
  file: 'border-border-strong bg-background text-foreground-90',
}

const LEGEND_KINDS: Array<MemoryRepoGraph['nodes'][number]['kind']> = ['lesson', 'topic', 'context', 'session', 'note', 'file']

const LEGEND_KEY: Record<MemoryRepoGraph['nodes'][number]['kind'], string> = {
  lesson: 'memory.repo.graph.legendLesson',
  topic: 'memory.repo.graph.legendTopic',
  context: 'memory.repo.graph.legendContext',
  session: 'memory.repo.graph.legendSession',
  note: 'memory.repo.graph.legendNote',
  file: 'memory.repo.graph.legendFile',
}

/** Open a node's file when it has one; returns whether a path was opened. */
export function openGraphNode(
  node: { data?: { path?: string } } | null | undefined,
  onOpenFile: (path: string) => void,
): boolean {
  const path = node?.data?.path
  if (!path) return false
  onOpenFile(path)
  return true
}

/** Deterministic grid position (no measuring) so the graph is stable in tests. */
export function graphGridPosition(index: number): { x: number; y: number } {
  return { x: (index % 4) * 208, y: Math.floor(index / 4) * 92 }
}

/** The canvas node control — a click opens the node's repo file. */
export function MemoryGraphNodeButton({ id, data, onOpen }: { id: string; data: MemoryGraphNodeData; onOpen: (path: string) => void }) {
  return (
    <button
      type="button"
      data-testid={`memory-repo-graph-node-${id}`}
      onClick={() => openGraphNode({ data }, onOpen)}
      className={cn('w-[184px] truncate rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left text-small outline-none focus-visible:ring-2 focus-visible:ring-accent', KIND_TONE[data.kind])}
    >
      {data.label}
    </button>
  )
}

type OpenFileHandler = (path: string) => void

/**
 * Latest `onOpenFile` handed to the panel. The node wrapper below reads it at
 * click time, so the `nodeTypes` mapping can stay identity-stable (empty memo)
 * while behaviour still tracks the newest callback.
 */
const OpenFileRefContext = React.createContext<React.MutableRefObject<OpenFileHandler> | null>(null)

/** Module-level node component: a stable identity across every panel render. */
function MemoryGraphNodeWrapper(props: NodeProps<MemoryGraphFlowNode>) {
  const openFileRef = React.useContext(OpenFileRefContext)
  return (
    <MemoryGraphNodeButton
      id={props.id}
      data={props.data as MemoryGraphNodeData}
      onOpen={(path) => openFileRef?.current?.(path)}
    />
  )
}

export function MemoryRepoGraphLegend() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-2 text-caption" data-testid="memory-repo-graph-legend">
      <span className="text-caption font-medium uppercase tracking-wide text-text-muted/70">{t('memory.repo.graph.legend')}</span>
      {LEGEND_KINDS.map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-full border', KIND_TONE[kind])} aria-hidden="true" />
          {t(LEGEND_KEY[kind])}
        </span>
      ))}
    </div>
  )
}

export function MemoryRepoGraphPanel({ graph, onOpenFile }: MemoryRepoGraphPanelProps) {
  const { t } = useTranslation()

  // Keep the newest callback reachable by the module-level node wrapper without
  // changing the wrapper's identity (and thus without invalidating nodeTypes).
  const onOpenFileRef = React.useRef<OpenFileHandler>(onOpenFile)
  React.useEffect(() => {
    onOpenFileRef.current = onOpenFile
  }, [onOpenFile])

  const nodeTypes = React.useMemo(() => ({ memoryNode: MemoryGraphNodeWrapper }), [])

  const { nodes, edges } = React.useMemo(() => {
    if (!graph) return { nodes: [] as MemoryGraphFlowNode[], edges: [] as Edge[] }
    const ids = new Set(graph.nodes.map((node) => node.id))
    const flowNodes: MemoryGraphFlowNode[] = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'memoryNode',
      position: graphGridPosition(index),
      width: 184,
      height: 34,
      data: { label: node.label, kind: node.kind, path: node.path },
    }))
    const flowEdges: Edge[] = graph.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge, index) => ({
        id: `${edge.kind}:${edge.from}->${edge.to}:${index}`,
        source: edge.from,
        target: edge.to,
        animated: edge.kind === 'provenance',
        style: { strokeWidth: 1 },
      }))
    return { nodes: flowNodes, edges: flowEdges }
  }, [graph])

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center" data-testid="memory-repo-graph-empty">
        <span className="grid size-12 place-items-center rounded-[var(--radius-control)] bg-accent/10 text-accent">
          <Network aria-hidden="true" className="icon-empty" />
        </span>
        <p className="text-sm text-text-secondary">{t('memory.repo.graph.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="memory-repo-graph-panel">
      <MemoryRepoGraphLegend />
      <div className="min-h-0 flex-1">
        <OpenFileRefContext.Provider value={onOpenFileRef}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              minZoom={0.2}
              maxZoom={1.5}
              defaultViewport={{ x: 24, y: 24, zoom: 1 }}
              proOptions={{ hideAttribution: true }}
              className="bg-background"
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            </ReactFlow>
          </ReactFlowProvider>
        </OpenFileRefContext.Provider>
      </div>
    </div>
  )
}
