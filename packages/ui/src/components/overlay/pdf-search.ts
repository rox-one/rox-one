export function findMatchingPages(pageTexts: readonly string[], query: string): number[] {
  const needle = normalizeSearchText(query)
  if (!needle) return []

  const matches: number[] = []
  for (const [index, text] of pageTexts.entries()) {
    if (normalizeSearchText(text).includes(needle)) matches.push(index + 1)
  }
  return matches
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}
