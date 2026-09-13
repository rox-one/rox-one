export type NoteHighlightComment = {
  id: string
  quote: string
  body: string
}

export function quoteOffsets(haystack: string, quote: string): Array<{ start: number; end: number }> {
  const needle = quote.trim()
  if (!needle) return []
  const hits: Array<{ start: number; end: number }> = []
  let from = 0
  while (from < haystack.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    hits.push({ start, end: start + needle.length })
    from = start + needle.length
  }
  return hits
}

export function commentsForQuote(
  comments: readonly NoteHighlightComment[],
  quote: string,
): NoteHighlightComment[] {
  const needle = quote.trim()
  if (!needle) return []
  return comments.filter((comment) => comment.quote.trim() === needle || needle.includes(comment.quote.trim()) || comment.quote.trim().includes(needle))
}

export function selectionComposerOffset(
  selectionTop: number,
  editorTop: number,
  editorHeight: number,
  composerHeight = 148,
): number {
  const raw = selectionTop - editorTop
  const max = Math.max(8, editorHeight - composerHeight - 8)
  return Math.max(8, Math.min(raw, max))
}
