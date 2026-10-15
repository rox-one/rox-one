/**
 * Wave 14 (F2): the multi-cell selection model, as pure functions.
 *
 * The surface has exactly one «current» cell (its `focus`) and, optionally, a
 * second anchor cell; a contiguous range `min..max(anchor, focus)` is what is
 * selected. Keeping the arithmetic here — instead of inside the page's click
 * and key handlers — is what makes «which cells are selected» checkable without
 * a DOM: the page owns gestures, this module owns meaning.
 *
 * `anchor === null` means a single-cell selection (just the focus), which is the
 * resting state every plain click, `j`/`k`, and every mutating command lands on;
 * only an explicit range gesture (`Shift+click`, `Shift+↑/↓`) sets the anchor.
 */

/** The selection state: the focused cell plus the range anchor, if any. */
export interface CellSelection {
  /** The cell that owns the keyboard focus (the primary of the range). */
  focus: number
  /** The other end of the range, or `null` for a single-cell selection. */
  anchor: number | null
}

/**
 * Clamp a document index into `[0, count - 1]`.
 *
 * An empty document has no valid index, so it answers `0` — the value callers
 * store right back into a state that never renders while the document is empty.
 */
export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(i, 0), count - 1)
}

/**
 * Clamp a selection into the document's bounds, or `null` when there is no
 * selection or the document has no cells. Every read path normalizes first, so
 * a stale index left over from a re-read document can never address a cell that
 * does not exist.
 */
export function normalizeSelection(sel: CellSelection | null, count: number): CellSelection | null {
  if (sel === null || count <= 0) return null
  return {
    focus: clampIndex(sel.focus, count),
    anchor: sel.anchor === null ? null : clampIndex(sel.anchor, count),
  }
}

/**
 * The selected cell indices, in ascending document order. A single-cell
 * selection answers one index; a range answers every index between its two
 * ends, inclusive.
 */
export function selectedIndices(sel: CellSelection | null, count: number): number[] {
  const normalized = normalizeSelection(sel, count)
  if (normalized === null) return []
  const { focus, anchor } = normalized
  if (anchor === null || anchor === focus) return [focus]
  const start = Math.min(anchor, focus)
  const end = Math.max(anchor, focus)
  const indices: number[] = []
  for (let index = start; index <= end; index += 1) indices.push(index)
  return indices
}

/**
 * Move the focus (a range gesture), keeping the anchor if one is set and
 * initializing it to the current focus on the first extension. The result is
 * the caller's job to normalize against the document's length.
 */
export function extendSelection(sel: CellSelection, focus: number): CellSelection {
  return { focus, anchor: sel.anchor ?? sel.focus }
}

/** Drop the anchor, collapsing a range back to its focus. A null stays null. */
export function collapseSelection(sel: CellSelection | null): CellSelection | null {
  if (sel === null) return null
  return { focus: sel.focus, anchor: null }
}
