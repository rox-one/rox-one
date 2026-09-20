import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Braces, Clock, Filter, GitBranch, Group, MessageSquare, Save, Trash2, Webhook } from 'lucide-react'
import { compileAutomationGraph } from '@craft-agent/shared/automations/graph'
import type { AutomationGraph, AutomationGraphNode } from '@craft-agent/shared/automations/types'
import { cn } from '@/lib/utils'
import { NODE_HEIGHT, fitGraphLayout, nodeDisplayLabel } from './graph-fit-layout'

export interface AutomationGraphEditorProps {
  graph: AutomationGraph
  onChange: (graph: AutomationGraph) => void
  onSave: (graph: AutomationGraph) => Promise<void> | void
  selectedNodeId?: string | null
  onSelectedNodeChange?: (nodeId: string | null) => void
  disabled?: boolean
  className?: string
}

const NODE_ACCENT: Record<AutomationGraphNode['kind'], string> = {
  trigger: 'border-sky-500/70 bg-card text-foreground',
  matcher: 'border-violet-500/70 bg-card text-foreground',
  prompt: 'border-emerald-500/70 bg-card text-foreground',
  webhook: 'border-amber-500/70 bg-card text-foreground',
  annotation: 'border-border bg-card text-foreground',
  group: 'border-border bg-card text-foreground',
  decision: 'border-orange-500/70 bg-card text-foreground',
}

const NODE_ICON: Record<AutomationGraphNode['kind'], React.ComponentType<{ className?: string }>> = {
  trigger: Clock,
  matcher: Filter,
  prompt: MessageSquare,
  webhook: Webhook,
  annotation: Braces,
  group: Group,
  decision: GitBranch,
}

export function AutomationGraphEditor({
  graph,
  onChange,
  onSave,
  selectedNodeId,
  onSelectedNodeChange,
  disabled = false,
  className,
}: AutomationGraphEditorProps) {
  const { t } = useTranslation()
  const [internalSelectedNodeId, setInternalSelectedNodeId] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const markerId = React.useId()
  const canvasRef = React.useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = React.useState(0)
  const dragState = React.useRef<{
    nodeId: string
    originX: number
    originY: number
    startX: number
    startY: number
  } | null>(null)
  const selectedId = selectedNodeId === undefined ? internalSelectedNodeId : selectedNodeId
  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null
  const nodeKindLabels: Record<AutomationGraphNode['kind'], string> = {
    trigger: t('automations.sectionWhen'),
    matcher: t('automations.matching'),
    prompt: t('automations.badgePrompt'),
    webhook: t('automations.badgeWebhook'),
    annotation: t('common.description'),
    group: t('common.selected'),
    decision: t('automations.sectionIf'),
  }

  const selectNode = React.useCallback((nodeId: string | null) => {
    if (selectedNodeId === undefined) setInternalSelectedNodeId(nodeId)
    onSelectedNodeChange?.(nodeId)
  }, [onSelectedNodeChange, selectedNodeId])

  const updateNode = React.useCallback((nextNode: AutomationGraphNode) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === nextNode.id ? nextNode : node),
    })
  }, [graph, onChange])

  const deleteSelectedMetadata = React.useCallback(() => {
    if (!selectedNode || (selectedNode.kind !== 'annotation' && selectedNode.kind !== 'group' && selectedNode.kind !== 'decision')) return
    onChange({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== selectedNode.id),
      edges: graph.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    })
    selectNode(null)
  }, [graph, onChange, selectNode, selectedNode])

  const save = React.useCallback(async () => {
    try {
      compileAutomationGraph(graph)
      setSaveError(null)
      setIsSaving(true)
      await onSave(graph)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('auth.somethingWentWrongRetry'))
    } finally {
      setIsSaving(false)
    }
  }, [graph, onSave, t])

  React.useEffect(() => {
    const moveNode = (event: PointerEvent) => {
      const drag = dragState.current
      if (!drag) return
      const nextPosition = {
        x: Math.max(0, Math.round(drag.originX + event.clientX - drag.startX)),
        y: Math.max(0, Math.round(drag.originY + event.clientY - drag.startY)),
      }
      onChange({
        ...graph,
        nodes: graph.nodes.map((node) => node.id === drag.nodeId ? { ...node, position: nextPosition } : node),
      })
    }
    const finishMove = () => {
      dragState.current = null
    }
    window.addEventListener('pointermove', moveNode)
    window.addEventListener('pointerup', finishMove)
    return () => {
      window.removeEventListener('pointermove', moveNode)
      window.removeEventListener('pointerup', finishMove)
    }
  }, [graph, onChange])

  React.useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    setViewportWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fittedNodes = React.useMemo(
    () => fitGraphLayout(graph.nodes, viewportWidth),
    [graph.nodes, viewportWidth],
  )
  const fittedById = React.useMemo(
    () => new Map(fittedNodes.map((node) => [node.id, node])),
    [fittedNodes],
  )
  const graphWidth = fittedNodes.reduce((max, node) => Math.max(max, node.x + node.width + 8), 1)
  const graphHeight = fittedNodes.reduce((max, node) => Math.max(max, node.y + NODE_HEIGHT + 8), 1)

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background', className)}>
      <header className="flex shrink-0 items-center justify-end gap-2 border-b border-border/60 px-3 py-2">
        <button
          type="button"
          disabled={disabled || isSaving}
          onClick={() => { void save() }}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          <Save className="size-3.5" />
          {isSaving ? t('common.saving') : t('common.save')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="min-w-0 flex-1 overflow-auto bg-muted/[0.14] p-3">
          <div className="relative" style={{ width: graphWidth, height: graphHeight }}>
            {graph.nodes.length === 0 ? (
              <p className="flex h-full items-center justify-center px-6 text-center text-sm text-foreground/70">
                {t('automations.noAutomationsConfigured')}
              </p>
            ) : (
              <>
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
                  <defs>
                    <marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L0,6 L6,3 z" className="fill-foreground/70" />
                    </marker>
                  </defs>
                  {graph.edges.map((edge) => {
                    const source = fittedById.get(edge.source)
                    const target = fittedById.get(edge.target)
                    if (!source || !target) return null
                    const isFlow = edge.kind === 'flow'
                    return (
                      <line
                        key={edge.id}
                        x1={source.x + source.width}
                        y1={source.y + 32}
                        x2={target.x}
                        y2={target.y + 32}
                        markerEnd={isFlow ? `url(#${markerId})` : undefined}
                        className={isFlow ? 'stroke-foreground/70' : 'stroke-foreground/50'}
                        strokeWidth={isFlow ? 2 : 1.5}
                        strokeDasharray={isFlow ? undefined : '4 4'}
                      />
                    )
                  })}
                </svg>

                {graph.nodes.map((node) => {
                  const layout = fittedById.get(node.id)
                  if (!layout) return null
                  const Icon = NODE_ICON[node.kind]
                  const label = nodeDisplayLabel(node, nodeKindLabels)
                  const isSelected = node.id === selectedId
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-label={label}
                      aria-pressed={isSelected}
                      style={{ left: layout.x, top: layout.y, width: layout.width }}
                      onPointerDown={(event) => {
                        if (disabled || isSaving || event.button !== 0) return
                        event.currentTarget.setPointerCapture(event.pointerId)
                        dragState.current = {
                          nodeId: node.id,
                          originX: node.position.x,
                          originY: node.position.y,
                          startX: event.clientX,
                          startY: event.clientY,
                        }
                      }}
                      onPointerUp={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId)
                        }
                        dragState.current = null
                      }}
                      onClick={() => selectNode(node.id)}
                      className={cn(
                        'absolute flex h-16 cursor-grab items-center gap-2 rounded-lg border px-3 text-left shadow-thin transition-shadow hover:shadow-modal-small active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        NODE_ACCENT[node.kind],
                        isSelected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[10px] text-muted-foreground">{nodeKindLabels[node.kind]}</span>
                        <span className="block text-[11px] font-medium leading-snug line-clamp-2">{label}</span>
                      </span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {selectedNode && (
          <aside className="w-56 shrink-0 border-l border-border/60 p-3">
            <div className="space-y-3">
              <input
                value={selectedNode.label ?? ''}
                onChange={(event) => updateNode({ ...selectedNode, label: event.target.value || undefined })}
                disabled={disabled || isSaving}
                aria-label={t('common.edit')}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              {selectedNode.kind === 'annotation' && (
                <textarea
                  value={selectedNode.data.text ?? ''}
                  onChange={(event) => updateNode({ ...selectedNode, data: { ...selectedNode.data, text: event.target.value || undefined } })}
                  disabled={disabled || isSaving}
                  aria-label={t('common.description')}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              )}
              {selectedNode.kind === 'decision' && (
                <textarea
                  value={selectedNode.data.expression ?? ''}
                  onChange={(event) => updateNode({ ...selectedNode, data: { ...selectedNode.data, expression: event.target.value || undefined } })}
                  disabled={disabled || isSaving}
                  aria-label={t('automations.sectionIf')}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              )}
              {(selectedNode.kind === 'annotation' || selectedNode.kind === 'group' || selectedNode.kind === 'decision') && (
                <button
                  type="button"
                  disabled={disabled || isSaving}
                  onClick={deleteSelectedMetadata}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  {t('common.delete')}
                </button>
              )}
            </div>
          </aside>
        )}
      </div>

      {saveError && <p className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{saveError}</p>}
    </section>
  )
}
