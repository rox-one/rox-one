import type { SessionScene } from '@craft-agent/core/mindmap'

export type SessionNodeKind = 'note' | 'model' | 'tool' | 'memory'

export const SESSION_NODE_KIND_LABELS: Record<SessionNodeKind, string> = {
  note: 'Note',
  model: 'Model',
  tool: 'Tool',
  memory: 'Memory',
}

const MEMORY_PATTERNS = [
  'memory',
  'remember',
  'recall',
  'lookup',
  'search',
  'context',
  'history',
  'knowledge',
]

export function deriveSessionNodeKind(scene: SessionScene): SessionNodeKind {
  if (scene.tools.length > 0) return 'tool'

  const text = `${scene.triggerPreview} ${scene.outcomePreview}`.toLowerCase()
  if (MEMORY_PATTERNS.some((pattern) => text.includes(pattern))) return 'memory'
  if (scene.outcomePreview.trim()) return 'model'
  return 'note'
}
