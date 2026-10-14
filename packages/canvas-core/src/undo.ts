import * as Y from 'yjs'
import type { CanvasDoc, Origin } from './doc.ts'

/**
 * Per-actor undo: only transactions whose origin is this exact actor are
 * tracked, so a user never undoes a collaborator's or an agent's edit.
 * Origins must be the same object instance passed to CanvasDoc writes.
 */
export function createUndoManager(board: CanvasDoc, origin: Origin, captureTimeout = 400): Y.UndoManager {
  return new Y.UndoManager([board.meta, board.objects, board.assets, board.comments], {
    trackedOrigins: new Set([origin]),
    captureTimeout,
  })
}
