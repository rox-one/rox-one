/**
 * Wave 14 (SPEC §F5): the pure undo/redo core of the «Кукбуки» surface.
 *
 * The surface records ONE history entry per structural gesture (a multi-delete
 * or a buffer paste is a single entry, not N). This module owns only the stack
 * arithmetic over plain data: it never touches the DOM, React or the IPC. The
 * page (slice E) turns `HistoryEntry.undo` / `HistoryEntry.redo` into the
 * `CookbooksCellMutation` ops it already sends through `cookbooks-lab:mutate`.
 *
 * Contract (frozen by the SPEC):
 * - history depth is capped at `limit` (default `HISTORY_LIMIT = 50`); the
 *   OLDEST entries fall off first;
 * - pushing a new entry CLEARS the redo (future) stack;
 * - `undoStep` / `redoStep` are pure — they return the next `History` plus the
 *   entry that was moved, or `null` when the respective stack is empty, and
 *   never mutate their argument;
 * - `invertOp` flips direction: `add <-> delete` (same index/type/source),
 *   `move(from, to) -> move(to, from)`, `convert(a, b) -> convert(b, a)`; a
 *   `duplicate` has no positional inverse and returns `null` (the page builds
 *   its delete-pair explicitly).
 *
 * Multi-op ordering: `entry.undo` is applied in array order by the page; for a
 * delete group the page orders the ops by DESCENDING index when it builds the
 * entry (deleting from the tail keeps earlier indices valid).
 */

/** One reversible structural operation, positional like `CookbooksCellMutation`. */
export type HistoryOp =
  | { kind: 'add'; index: number; cellType: 'code' | 'markdown'; source: string }
  | { kind: 'delete'; index: number; cellType: 'code' | 'markdown'; source: string }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'duplicate'; index: number }
  | { kind: 'convert'; index: number; fromType: 'code' | 'markdown'; toType: 'code' | 'markdown' }

/**
 * One undoable gesture: the i18n label the toast reports, the ops that revert
 * it (`undo`) and the ops that re-apply it (`redo`).
 */
export interface HistoryEntry {
  labelKey: string
  undo: HistoryOp[]
  redo: HistoryOp[]
}

/**
 * The two-stack history. `limit` travels with the value so `pushEntry` can cap
 * without a second argument; it defaults to `HISTORY_LIMIT`.
 */
export interface History {
  past: HistoryEntry[]
  future: HistoryEntry[]
  limit: number
}

/** Default history depth (SPEC §Решения 5). */
export const HISTORY_LIMIT = 50

/** A fresh, empty history bounded by `limit` (default `HISTORY_LIMIT`). */
export function createHistory(limit: number = HISTORY_LIMIT): History {
  return { past: [], future: [], limit }
}

/**
 * Record a new gesture: appends to `past`, clears the redo stack, and drops the
 * oldest entries once the depth exceeds `h.limit`. Returns a new `History`.
 */
export function pushEntry(h: History, e: HistoryEntry): History {
  const past = [...h.past, e]
  // Cap from the front: the oldest entries fall off first.
  const capped = past.length > h.limit ? past.slice(past.length - h.limit) : past
  return { past: capped, future: [], limit: h.limit }
}

/**
 * Undo the most recent gesture: move `past`'s tail onto `future`. Returns the
 * next history and the entry the caller must revert, or `null` on an empty
 * stack.
 */
export function undoStep(h: History): { history: History; entry: HistoryEntry } | null {
  if (h.past.length === 0) return null
  const entry = h.past[h.past.length - 1]
  return {
    history: { past: h.past.slice(0, -1), future: [entry, ...h.future], limit: h.limit },
    entry,
  }
}

/**
 * Redo the most recently undone gesture: move `future`'s head back onto `past`.
 * Returns the next history and the entry the caller must re-apply, or `null` on
 * an empty stack.
 */
export function redoStep(h: History): { history: History; entry: HistoryEntry } | null {
  if (h.future.length === 0) return null
  const entry = h.future[0]
  return {
    history: { past: [...h.past, entry], future: h.future.slice(1), limit: h.limit },
    entry,
  }
}

/** Whether there is a gesture to undo. */
export function canUndo(h: History): boolean {
  return h.past.length > 0
}

/** Whether there is a gesture to redo. */
export function canRedo(h: History): boolean {
  return h.future.length > 0
}

/**
 * Inverse of a single op: `add <-> delete` (same index/type/source),
 * `move(from, to) -> move(to, from)`, `convert(a, b) -> convert(b, a)`.
 * A `duplicate` has no positional inverse and yields `null`.
 */
export function invertOp(op: HistoryOp): HistoryOp | null {
  switch (op.kind) {
    case 'add':
      return { kind: 'delete', index: op.index, cellType: op.cellType, source: op.source }
    case 'delete':
      return { kind: 'add', index: op.index, cellType: op.cellType, source: op.source }
    case 'move':
      return { kind: 'move', from: op.to, to: op.from }
    case 'convert':
      return { kind: 'convert', index: op.index, fromType: op.toType, toType: op.fromType }
    case 'duplicate':
      return null
  }
}
