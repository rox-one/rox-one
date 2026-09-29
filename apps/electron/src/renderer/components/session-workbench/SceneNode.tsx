import * as React from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { SceneNodeData } from './to-flow-elements'
import type { SessionNodeKind } from './node-kinds'
import { canvasNodeStatus, canvasStatusClass, type CanvasRunStatus } from './canvas-layout'
import { formatToolGroup, groupSceneTools } from './scene-tools'
import { MIN_SCENE_SIZE } from './map-node-size'

export type SceneFlowNode = Node<SceneNodeData, 'scene'>

export function sceneVisualStatus(tools: SceneNodeData['scene']['tools'], selected?: boolean): CanvasRunStatus {
  const toolStatus = tools.some((t) => t.status === 'error')
    ? 'error'
    : tools.some((t) => t.status === 'pending')
      ? 'pending'
      : 'ok'
  return canvasNodeStatus({
    selected,
    toolStatus,
    streaming: tools.some((t) => t.status === 'pending' && t.name === 'stream'),
  })
}

function kindTone(kind: SessionNodeKind): string {
  switch (kind) {
    case 'note':
      return 'bg-amber-500/15 text-amber-100'
    case 'model':
      return 'bg-violet-500/15 text-violet-100'
    case 'tool':
      return 'bg-cyan-500/15 text-cyan-100'
    case 'memory':
      return 'bg-emerald-500/15 text-emerald-100'
    case 'subflow':
      return 'bg-sky-500/15 text-sky-100'
    case 'condition':
      return 'bg-orange-500/15 text-orange-100'
    case 'merge':
      return 'bg-pink-500/15 text-pink-100'
    case 'human_input':
      return 'bg-blue-500/15 text-blue-100'
    case 'output':
      return 'bg-lime-500/15 text-lime-100'
    case 'annotation_frame':
      return 'bg-white/10 text-white/80'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function SceneNode({ id, data, selected }: NodeProps<SceneFlowNode>) {
  const scene = data.scene
  const kind = data.kind
  const kindLabel = data.kindLabel ?? kind
  const status = sceneVisualStatus(scene.tools, selected)
  const toolGroups = groupSceneTools(scene.tools)
  return (
    <div
      className={cn(
        // Flat surface, no outline; selection is a single accent ring.
        'group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg bg-foreground/[0.05] px-2.5 py-2 text-left',
        canvasStatusClass(status),
        scene.orphaned && 'bg-amber-400/[0.08]',
        selected && 'ring-2 ring-accent',
      )}
      data-status={status}
      title={scene.triggerPreview || scene.id}
    >
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={MIN_SCENE_SIZE.width}
        minHeight={MIN_SCENE_SIZE.height}
        lineClassName="!border-accent/60"
        handleClassName="!h-2 !w-2 !rounded-sm !border-0 !bg-accent"
        onResizeEnd={(_event, box) => data.onResize?.(id, box)}
      />
      <Handle type="target" position={Position.Left} className="rox-map-handle !h-2 !w-2 !border-0 !bg-foreground/40" />
      <div className="mb-1 flex min-w-0 items-center gap-1.5">
        <div
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            status === 'error' && 'bg-rose-400',
            status === 'waiting' && 'animate-pulse bg-amber-300',
            status === 'running' && 'animate-pulse bg-sky-400',
            (status === 'idle' || status === 'selected') && 'bg-emerald-400',
          )}
        />
        <span
          className={cn(
            'min-w-0 truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]',
            kindTone(kind),
          )}
        >
          {kindLabel}
        </span>
        {scene.orphaned ? (
          <span className="shrink-0 text-[9px] uppercase tracking-[0.12em] text-amber-300/80">orphaned</span>
        ) : null}
      </div>
      <div className="line-clamp-2 min-w-0 break-words text-[12px] font-medium leading-4 text-foreground">
        {scene.triggerPreview || scene.id}
      </div>
      {toolGroups.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {toolGroups.slice(0, 4).map((group) => (
            <span
              key={group.name}
              className={cn(
                'rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground',
                group.status === 'error' && 'text-rose-300',
              )}
            >
              {formatToolGroup(group)}
            </span>
          ))}
          {toolGroups.length > 4 ? (
            <span className="px-1 py-0.5 text-[10px] text-muted-foreground/70">+{toolGroups.length - 4}</span>
          ) : null}
        </div>
      )}
      {scene.outcomePreview ? (
        <div className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground/85">
          {scene.outcomePreview}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="rox-map-handle !h-2 !w-2 !border-0 !bg-foreground/40" />
    </div>
  )
}
