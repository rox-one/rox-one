/**
 * Multi-select helpers for the Задачи list (⌘/Ctrl-click toggles, ⇧-click
 * selects a range in visible order). Pure functions — the page keeps the Set.
 */
export function toggleInSelection(selection: ReadonlySet<string>, id: string, seed?: string | null): Set<string> {
  const next = new Set(selection)
  // First ⌘-click on another row keeps the currently focused row selected.
  if (next.size === 0 && seed && seed !== id) next.add(seed)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function rangeSelection(order: readonly string[], anchor: string | null | undefined, id: string): Set<string> {
  const to = order.indexOf(id)
  if (to < 0) return new Set()
  const from = anchor ? order.indexOf(anchor) : -1
  if (from < 0) return new Set([id])
  const [lo, hi] = from <= to ? [from, to] : [to, from]
  return new Set(order.slice(lo, hi + 1))
}

/** Drops ids that are no longer visible; returns the same Set when unchanged. */
export function pruneSelection(selection: Set<string>, order: readonly string[]): Set<string> {
  if (selection.size === 0) return selection
  const visible = new Set(order)
  let changed = false
  const next = new Set<string>()
  for (const id of selection) {
    if (visible.has(id)) next.add(id)
    else changed = true
  }
  return changed ? next : selection
}

/** Selected ids in visible order (stable for bulk operations and undo). */
export function orderedSelection(selection: ReadonlySet<string>, order: readonly string[]): string[] {
  return order.filter((id) => selection.has(id))
}
