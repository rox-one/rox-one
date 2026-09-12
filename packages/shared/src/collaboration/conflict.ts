/**
 * Simultaneous prompt / annotation conflict model.
 * Last-writer-wins on the same target, both actors remain in the audit stamp.
 */

export type ConcurrentEditKind = 'prompt' | 'annotation'

export interface ConcurrentEdit {
  kind: ConcurrentEditKind
  targetId: string
  actorAccountId: string
  writtenAt: number
  body: string
}

export interface ConflictResolution {
  winner: ConcurrentEdit
  conflict: boolean
  actors: string[]
}

export function resolveConcurrentEdit(a: ConcurrentEdit, b: ConcurrentEdit): ConflictResolution {
  if (a.kind !== b.kind || a.targetId !== b.targetId) {
    throw new Error('concurrent edits must share kind and target')
  }
  const winner = a.writtenAt >= b.writtenAt ? a : b
  const conflict = a.actorAccountId !== b.actorAccountId && a.body !== b.body
  const actors = Array.from(new Set([a.actorAccountId, b.actorAccountId]))
  return { winner, conflict, actors }
}
