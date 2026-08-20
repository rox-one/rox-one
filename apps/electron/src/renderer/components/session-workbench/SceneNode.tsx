import * as React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { SceneNodeData } from './to-flow-elements'

export type SceneFlowNode = Node<SceneNodeData, 'scene'>

function sceneStatus(tools: SceneNodeData['scene']['tools']): 'error' | 'pending' | 'ok' {
  if (tools.some((t) => t.status === 'error')) return 'error'
  if (tools.some((t) => t.status === 'pending')) return 'pending'
  return 'ok'
}

export function SceneNode({ data, selected }: NodeProps<SceneFlowNode>) {
  const scene = data.scene
  const status = sceneStatus(scene.tools)
  return (
    <div
      className={cn(
        'w-[180px] rounded-[12px] border bg-card px-2 py-1.5 text-left shadow-sm',
        scene.orphaned ? 'border-amber-400' : 'border-border',
        selected && 'ring-1 ring-violet-400/40 border-violet-400',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-border !bg-muted-foreground/50" />
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'error' && 'bg-destructive',
            status === 'pending' && 'bg-amber-400',
            status === 'ok' && 'bg-emerald-500',
          )}
        />
        <div className="min-w-0 truncate text-xs font-medium">
          {scene.triggerPreview || scene.id}
        </div>
      </div>
      {scene.tools.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {scene.tools.slice(0, 4).map((tool) => (
            <span
              key={tool.toolCallId}
              className="rounded bg-foreground/5 px-1 font-mono text-[10px] text-muted-foreground"
            >
              {tool.name}
            </span>
          ))}
        </div>
      )}
      {scene.outcomePreview ? (
        <div className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
          {scene.outcomePreview}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-border !bg-muted-foreground/50" />
    </div>
  )
}
