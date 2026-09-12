import { createCanvasEdge, createCanvasNode, createDraftSpec } from './graph.ts'
import type { CanvasNodeKind, SessionWorkflowSpec } from './types.ts'

export type PromoteScene = {
  id: string
  triggerMessageId: string
  assistantMessageIds: string[]
  tools: Array<{ name: string }>
  triggerPreview: string
  outcomePreview: string
  parentSceneId: string | null
}

export type PromoteKindHint = (scene: PromoteScene) => CanvasNodeKind

export const defaultPromoteKind: PromoteKindHint = (scene) => {
  if (scene.tools.length > 0) return 'tool'
  if (/memory|remember|recall|lookup|knowledge/i.test(`${scene.triggerPreview} ${scene.outcomePreview}`)) return 'memory'
  if (scene.outcomePreview.trim()) return 'model'
  return 'note'
}

export function promoteTraceToDraft({
  sessionId,
  scenes,
  kindFor = defaultPromoteKind,
  now = Date.now(),
  columnWidth = 280,
  rowHeight = 140,
}: {
  sessionId: string
  scenes: readonly PromoteScene[]
  kindFor?: PromoteKindHint
  now?: number
  columnWidth?: number
  rowHeight?: number
}): SessionWorkflowSpec {
  const spec = createDraftSpec(sessionId, now)
  const nodes = scenes.map((scene, index) =>
    createCanvasNode({
      id: `n_${scene.id}`,
      kind: kindFor(scene),
      title: scene.triggerPreview || scene.id,
      position: { x: 40 + (index % 4) * columnWidth, y: 40 + Math.floor(index / 4) * rowHeight },
      permissionMode: 'ask',
      provenance: {
        sessionId,
        sceneId: scene.id,
        messageIds: [scene.triggerMessageId, ...scene.assistantMessageIds],
      },
      now: now + index,
    }),
  )
  const byScene = new Map(scenes.map((scene, index) => [scene.id, nodes[index]!.id]))
  const edges = []
  for (const scene of scenes) {
    if (!scene.parentSceneId) continue
    const source = byScene.get(scene.parentSceneId)
    const target = byScene.get(scene.id)
    if (!source || !target) continue
    edges.push(createCanvasEdge({ source, target, now }))
  }
  return { ...spec, nodes, edges }
}
