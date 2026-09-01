import * as React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { SceneNodeData } from './to-flow-elements'
import type { SessionNodeKind } from './node-kinds'

export type SceneFlowNode = Node<SceneNodeData, 'scene'>

function sceneStatus(tools: SceneNodeData['scene']['tools']): 'error' | 'pending' | 'ok' {
  if (tools.some((t) => t.status === 'error')) return 'error'
  if (tools.some((t) => t.status === 'pending')) return 'pending'
  return 'ok'
}

function kindTone(kind: SessionNodeKind): string {
  switch (kind) {
    case 'note':
      return 'bg-amber-500/15 text-amber-100 ring-amber-400/20'
    case 'model':
      return 'bg-violet-500/15 text-violet-100 ring-violet-400/20'
    case 'tool':
      return 'bg-cyan-500/15 text-cyan-100 ring-cyan-400/20'
    case 'memory':
      return 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/20'
  }
}

export function SceneNode({ data, selected }: NodeProps<SceneFlowNode>) {
  const scene = data.scene
  const kind = data.kind
  const kindLabel = data.kindLabel ?? kind
  const status = sceneStatus(scene.tools)
  return (
    <div
      className={cn(
        'group relative w-[198px] min-w-0 overflow-hidden rounded-xl border bg-card/80 px-2.5 py-2 text-left shadow-strong backdrop-blur-xl',
        scene.orphaned ? 'border-amber-400/50' : 'border-white/10',
        selected && 'border-violet-400/70 ring-1 ring-violet-400/30',
      )}
      title={scene.triggerPreview || scene.id}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-border !bg-background/90" />
      <div className="mb-1.5 flex min-w-0 items-start gap-2">
        <div
          aria-hidden
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-white/[0.02]',
            status === 'error' && 'bg-rose-400',
            status === 'pending' && 'animate-pulse bg-amber-300',
            status === 'ok' && 'bg-emerald-400',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1 truncate text-[12px] font-medium leading-4 text-foreground">
              {scene.triggerPreview || scene.id}
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] ring-1',
                kindTone(kind),
              )}
            >
              {kindLabel}
            </span>
          </div>
          {scene.orphaned ? (
            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-amber-300/80">
              orphaned
            </div>
          ) : null}
        </div>
      </div>
      {scene.tools.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {scene.tools.slice(0, 4).map((tool) => (
            <span
              key={tool.toolCallId}
              className="rounded-md border border-white/5 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}
      {scene.outcomePreview ? (
        <div className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground/85">
          {scene.outcomePreview}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-border !bg-background/90" />
    </div>
  )
}
