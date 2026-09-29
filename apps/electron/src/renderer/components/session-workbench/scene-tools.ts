import type { SessionScene } from '@craft-agent/core/mindmap'

export type SceneToolGroup = {
  name: string
  count: number
  status: 'ok' | 'error' | 'pending'
}

/** Collapse repeated tool calls into «read ×4» chips, keeping first-seen order. */
export function groupSceneTools(tools: SessionScene['tools']): SceneToolGroup[] {
  const groups = new Map<string, SceneToolGroup>()
  for (const tool of tools) {
    const status: SceneToolGroup['status'] =
      tool.status === 'error' ? 'error' : tool.status === 'pending' ? 'pending' : 'ok'
    const existing = groups.get(tool.name)
    if (!existing) {
      groups.set(tool.name, { name: tool.name, count: 1, status })
      continue
    }
    existing.count += 1
    if (status === 'error' || (status === 'pending' && existing.status === 'ok')) existing.status = status
  }
  return [...groups.values()]
}

export function formatToolGroup(group: Pick<SceneToolGroup, 'name' | 'count'>): string {
  return group.count > 1 ? `${group.name} ×${group.count}` : group.name
}

/** Short one-line title for chips that refer to a scene (e.g. a note's anchor). */
export function shortSceneTitle(scene: Pick<SessionScene, 'triggerPreview'> | null | undefined, max = 28): string | null {
  const text = scene?.triggerPreview?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
