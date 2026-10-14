import * as Y from 'yjs'
import type { CanvasDoc, Origin } from './doc.ts'

/**
 * Per-actor undo: Yjs tracks origins by object IDENTITY, not by value. Two
 * `{ kind: 'user', userId: 'u1' }` literals are different origins, and edits
 * made with the second one are invisible to an UndoManager built with the
 * first. Always obtain origins through `actorOrigin()` (memoized), or keep and
 * reuse the same object.
 */
const originCache = new Map<string, Origin>()

export function actorOrigin(kind: 'user', userId: string): Origin
export function actorOrigin(kind: 'agent', sessionId: string): Origin
export function actorOrigin(kind: 'user' | 'agent', id: string): Origin {
  const key = `${kind}:${id}`
  let o = originCache.get(key)
  if (!o) {
    o = kind === 'user' ? { kind: 'user', userId: id } : { kind: 'agent', sessionId: id }
    originCache.set(key, o)
  }
  return o
}

export function createUndoManager(board: CanvasDoc, origin: Origin, captureTimeout = 400): Y.UndoManager {
  if (origin.kind === 'user' && actorOrigin('user', origin.userId) !== origin) {
    console.warn('[canvas] createUndoManager: origin is not the memoized actorOrigin(); edits made with an equal but different object will not be undoable')
  }
  return new Y.UndoManager([board.meta, board.objects, board.assets, board.comments], {
    trackedOrigins: new Set([origin]),
    captureTimeout,
  })
}
