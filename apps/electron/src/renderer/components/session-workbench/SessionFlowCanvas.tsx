import * as React from 'react'
import { GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  projectSessionScenes,
  type SceneMessage,
  type SessionScene,
} from '@craft-agent/core/mindmap'

export type SessionFlowCanvasProps = {
  sessionId: string
  messages: SceneMessage[]
  onSelectMessage?: (messageId: string) => void
  onFork?: (messageId: string) => void
}

function depthsOf(scenes: SessionScene[]): Map<string, number> {
  const byId = new Map(scenes.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const walk = (id: string, stack = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!
    if (stack.has(id)) return 0
    const scene = byId.get(id)
    if (!scene?.parentSceneId) {
      memo.set(id, 0)
      return 0
    }
    stack.add(id)
    const d = walk(scene.parentSceneId, stack) + 1
    stack.delete(id)
    memo.set(id, d)
    return d
  }
  for (const s of scenes) walk(s.id)
  return memo
}

export function SessionFlowCanvas({
  sessionId,
  messages,
  onSelectMessage,
  onFork,
}: SessionFlowCanvasProps) {
  const { t } = useTranslation()
  const [camera, setCamera] = React.useState<'map' | 'flow'>('map')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const graph = React.useMemo(
    () => projectSessionScenes(sessionId, messages),
    [sessionId, messages],
  )
  const depths = React.useMemo(() => depthsOf(graph.scenes), [graph.scenes])
  const xStep = camera === 'flow' ? 280 : 200
  const yStep = camera === 'flow' ? 140 : 108
  const lane = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const scene of graph.scenes) {
    const d = depths.get(scene.id) ?? 0
    const row = lane.get(d) ?? 0
    lane.set(d, row + 1)
    positions.set(scene.id, { x: 24 + d * xStep, y: 24 + row * yStep })
  }
  const xs = [...positions.values()]
  const width = Math.max(640, ...xs.map((p) => p.x + 220), 1)
  const height = Math.max(320, ...xs.map((p) => p.y + 96), 1)
  const selected = graph.scenes.find((s) => s.id === selectedId) ?? null

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1 bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground">{t('entityView.flowLive')}</span>
        <span className="text-muted-foreground">· {graph.scenes.length}</span>
        <div className="pointer-events-auto ml-auto inline-flex rounded-md border border-border/60 bg-background/80 p-0.5 backdrop-blur">
          <button
            type="button"
            className={cn('rounded px-2 py-0.5', camera === 'map' && 'bg-foreground/10')}
            onClick={() => setCamera('map')}
          >
            {t('entityView.workbenchCameraMap')}
          </button>
          <button
            type="button"
            className={cn('rounded px-2 py-0.5', camera === 'flow' && 'bg-foreground/10')}
            onClick={() => setCamera('flow')}
          >
            {t('entityView.workbenchCameraFlow')}
          </button>
        </div>
      </div>
      {graph.scenes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t('entityView.workbenchNoScenes')}
        </div>
      ) : (
        <div className="absolute inset-0 overflow-auto">
          <div className="relative" style={{ width, height }}>
            <svg className="absolute inset-0" width={width} height={height}>
              {graph.edges.map((e) => {
                const a = positions.get(e.from)
                const b = positions.get(e.to)
                if (!a || !b) return null
                const x1 = a.x + 180
                const y1 = a.y + 28
                const x2 = b.x
                const y2 = b.y + 28
                return (
                  <path
                    key={`${e.from}-${e.to}`}
                    d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    className={e.kind === 'fork' ? 'stroke-violet-400' : 'stroke-border'}
                    strokeWidth={e.kind === 'fork' ? 2 : 1.2}
                  />
                )
              })}
            </svg>
            {graph.scenes.map((scene) => {
              const pos = positions.get(scene.id)!
              const on = selectedId === scene.id
              return (
                <button
                  key={scene.id}
                  type="button"
                  style={{ left: pos.x, top: pos.y }}
                  className={cn(
                    'absolute w-[180px] rounded-lg border bg-card px-2 py-1.5 text-left shadow-sm',
                    on ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-border/60',
                  )}
                  onClick={() => {
                    setSelectedId(scene.id)
                    onSelectMessage?.(scene.triggerMessageId)
                  }}
                >
                  <div className="truncate text-xs font-medium">
                    {scene.triggerPreview || scene.id}
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
                </button>
              )
            })}
          </div>
        </div>
      )}
      {selected && onFork ? (
        <button
          type="button"
          className="absolute right-3 top-10 z-10 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
          onClick={() => onFork(selected.triggerMessageId)}
        >
          <GitBranch className="h-3 w-3" />
          {t('entityView.workbenchFork')}
        </button>
      ) : null}
    </div>
  )
}
