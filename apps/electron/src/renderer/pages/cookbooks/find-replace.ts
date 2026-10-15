/**
 * Wave 13 (SPEC §F2): the pure find & replace core of the «Кукбуки» surface.
 *
 * The search area is the sources of every cell of an `ipynb` document, in
 * document order (markdown cells included). Nothing here touches the DOM or the
 * IPC: the page owns the panel, the focus and the `api.save` that delivers a
 * replacement, this module owns only the offset arithmetic over plain strings.
 *
 * Contract (frozen by the SPEC):
 * - an empty query matches nothing (`[]` / `{updates:{},count:0}`);
 * - matches are non-overlapping, left-to-right (`step = query.length`), and a
 *   multi-line query is a plain substring — offsets are kept against the
 *   ORIGINAL source, so a case-insensitive scan lowercases both sides for the
 *   comparison but never shifts the offsets;
 * - `undefined`/empty sources are skipped;
 * - `replaceAllInSources` rewrites each touched cell in one pass and returns
 *   ONLY the cells it actually changed.
 */

/** One occurrence of the query: the cell it lives in and its `[start, end)` span. */
export interface CookbooksFindMatch {
  cell: number
  start: number
  end: number
}

/**
 * Every non-overlapping occurrence of `query` across the document's sources,
 * in document order (cell-major, then left-to-right within a cell).
 */
export function computeMatches(
  sources: ReadonlyArray<string | undefined>,
  query: string,
  caseSensitive: boolean,
): CookbooksFindMatch[] {
  const matches: CookbooksFindMatch[] = []
  if (query.length === 0) return matches
  // The needle drives the scan step; `query.length` is the span the caller
  // highlights, so an ASCII query keeps both identical.
  const needle = caseSensitive ? query : query.toLowerCase()
  sources.forEach((source, cell) => {
    if (source === undefined || source.length === 0) return
    const haystack = caseSensitive ? source : source.toLowerCase()
    let from = 0
    while (from + needle.length <= haystack.length) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      matches.push({ cell, start: at, end: at + query.length })
      // Non-overlapping: the next scan starts after this match.
      from = at + needle.length
    }
  })
  return matches
}

/** Replace the `[start, end)` span of `source`, leaving every other byte alone. */
export function replaceMatch(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
}

/**
 * Replace every occurrence of `query` in every source. Returns the rewritten
 * text of the touched cells keyed by index (untouched cells are absent) plus the
 * total number of replacements — the count the notice reports.
 */
export function replaceAllInSources(
  sources: ReadonlyArray<string | undefined>,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { updates: Record<number, string>; count: number } {
  const updates: Record<number, string> = {}
  let count = 0
  if (query.length === 0) return { updates, count }
  const needle = caseSensitive ? query : query.toLowerCase()
  sources.forEach((source, cell) => {
    if (source === undefined || source.length === 0) return
    const haystack = caseSensitive ? source : source.toLowerCase()
    let from = 0
    let last = 0
    let result = ''
    let found = 0
    while (from + needle.length <= haystack.length) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      result += source.slice(last, at) + replacement
      last = at + needle.length
      from = at + needle.length
      found += 1
    }
    if (found === 0) return
    result += source.slice(last)
    updates[cell] = result
    count += found
  })
  return { updates, count }
}
