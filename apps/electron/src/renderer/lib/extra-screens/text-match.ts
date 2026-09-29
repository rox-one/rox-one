/** Case/diacritic-insensitive term matching used by Досье and Радар. */
export function normalizeText(value: string): string {
  return value.toLocaleLowerCase('ru').replace(/ё/g, 'е').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/** Terms shorter than 2 chars are dropped (too noisy). Duplicates removed. */
export function normalizeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const term of terms) {
    const norm = normalizeText(term.trim())
    if (norm.length >= 2) seen.add(norm)
  }
  return [...seen]
}

export function matchesAnyTerm(text: string | undefined | null, normalizedTerms: readonly string[]): boolean {
  if (!text || normalizedTerms.length === 0) return false
  const hay = normalizeText(text)
  return normalizedTerms.some((term) => hay.includes(term))
}
