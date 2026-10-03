/** Navigation is focus-only; committing a setting remains an explicit action. */
export function settingsMenuNavigationIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}

export function settingsMenuTypeaheadIndex(labels: string[], query: string, current: number): number | null {
  if (!query || labels.length === 0) return null
  const normalized = query.toLocaleLowerCase()
  // Repeating one character cycles through matches, as native selects do.
  const needle = [...normalized].every((character) => character === normalized[0])
    ? normalized[0]!
    : normalized
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (current + offset + labels.length) % labels.length
    if (labels[index]!.toLocaleLowerCase().startsWith(needle)) return index
  }
  return null
}
