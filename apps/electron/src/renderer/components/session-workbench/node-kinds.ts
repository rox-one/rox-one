import type { SessionScene } from '@craft-agent/core/mindmap'
import { CANVAS_NODE_KINDS, type CanvasNodeKind } from '@craft-agent/shared/workflows'

export type SessionNodeKind = CanvasNodeKind

export const SESSION_NODE_KINDS = CANVAS_NODE_KINDS

export const SESSION_NODE_KIND_LABELS: Record<SessionNodeKind, string> = {
  note: 'Note',
  model: 'Model',
  tool: 'Tool',
  memory: 'Memory',
  subflow: 'Subflow',
  condition: 'Condition',
  merge: 'Merge',
  human_input: 'Human input',
  output: 'Output',
  annotation_frame: 'Frame',
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
