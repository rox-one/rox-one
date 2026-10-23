import type { NoteCommentAnchor, NoteCommentThread } from '../../../shared/types'

const QUOTE_WINDOW = 48

export interface NoteTextSelection {
  fullText: string
  start: number
  end: number
  selectedText: string
}

export interface ResolvedNoteCommentAnchor {
  commentId: string
  start: number | null
  end: number | null
  stale: boolean
}

function clampOffset(value: number, text: string): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(text.length, Math.max(0, Math.floor(value)))
}

export function createNoteCommentAnchor(selection: NoteTextSelection): NoteCommentAnchor | null {
  const start = clampOffset(selection.start, selection.fullText)
  const end = clampOffset(selection.end, selection.fullText)
  const selectedText = selection.selectedText || selection.fullText.slice(start, end)
  if (end <= start || !selectedText.trim()) return null

  return {
    selectedText,
    selectors: [
      {
        type: 'text-position',
        start,
        end,
      },
      {
        type: 'text-quote',
        exact: selectedText,
        prefix: selection.fullText.slice(Math.max(0, start - QUOTE_WINDOW), start),
        suffix: selection.fullText.slice(end, Math.min(selection.fullText.length, end + QUOTE_WINDOW)),
      },
    ],
  }
}

function findQuoteWithContext(text: string, exact: string, prefix?: string, suffix?: string): { start: number; end: number } | null {
  if (!exact) return null

  let cursor = 0
  while (cursor <= text.length) {
    const index = text.indexOf(exact, cursor)
    if (index === -1) return null

    const before = text.slice(Math.max(0, index - (prefix?.length ?? 0)), index)
    const after = text.slice(index + exact.length, index + exact.length + (suffix?.length ?? 0))
    const prefixMatches = !prefix || before.endsWith(prefix)
    const suffixMatches = !suffix || after.startsWith(suffix)
    if (prefixMatches && suffixMatches) return { start: index, end: index + exact.length }

    cursor = index + Math.max(1, exact.length)
  }

  return null
}

/** Whole-document comments (and reply stubs) have no selection anchor. */
export function isDocumentNoteComment(comment: Pick<NoteCommentThread, 'anchor' | 'parentId'>): boolean {
  return !comment.parentId && !comment.anchor
}

export function resolveNoteCommentAnchor(text: string, anchor: NoteCommentAnchor | null | undefined): Omit<ResolvedNoteCommentAnchor, 'commentId'> {
  if (!anchor) return { start: null, end: null, stale: false }
  const position = anchor.selectors.find(selector => selector.type === 'text-position')
  const quote = anchor.selectors.find(selector => selector.type === 'text-quote')

  if (position) {
    const start = clampOffset(position.start, text)
    const end = clampOffset(position.end, text)
    if (end > start) {
      const selected = text.slice(start, end)
      const expected = quote?.exact ?? anchor.selectedText
      if (!expected || selected === expected) return { start, end, stale: false }
    }
  }

  if (quote) {
    const resolved = findQuoteWithContext(text, quote.exact, quote.prefix, quote.suffix)
    if (resolved) return { ...resolved, stale: false }

    const fallback = text.indexOf(quote.exact)
    if (fallback !== -1) return { start: fallback, end: fallback + quote.exact.length, stale: false }
  }

  const fallback = anchor.selectedText ? text.indexOf(anchor.selectedText) : -1
  if (fallback !== -1) return { start: fallback, end: fallback + anchor.selectedText.length, stale: false }

  return { start: null, end: null, stale: true }
}

export function resolveNoteCommentAnchors(text: string, comments: NoteCommentThread[]): Record<string, ResolvedNoteCommentAnchor> {
  return comments.reduce<Record<string, ResolvedNoteCommentAnchor>>((acc, comment) => {
    acc[comment.id] = {
      commentId: comment.id,
      ...resolveNoteCommentAnchor(text, comment.anchor),
    }
    return acc
  }, {})
}

export type NestedNoteCommentThread = NoteCommentThread & { replies: NoteCommentThread[] }

/** Group flat sidecar comments into one-level threads for the rail UI. */
export function nestNoteCommentThreads(comments: readonly NoteCommentThread[]): NestedNoteCommentThread[] {
  const roots: NestedNoteCommentThread[] = []
  const byId = new Map<string, NestedNoteCommentThread>()
  for (const comment of comments) {
    if (comment.parentId) continue
    const nested: NestedNoteCommentThread = { ...comment, replies: [] }
    byId.set(comment.id, nested)
    roots.push(nested)
  }
  for (const comment of comments) {
    if (!comment.parentId) continue
    const parent = byId.get(comment.parentId)
    if (parent) parent.replies.push(comment)
    else {
      // Orphan reply: surface as its own root so it is not lost.
      roots.push({ ...comment, parentId: undefined, replies: [] })
    }
  }
  roots.sort((a, b) => a.createdAt - b.createdAt)
  for (const root of roots) root.replies.sort((a, b) => a.createdAt - b.createdAt)
  return roots
}

/** Build a selection anchor from note text + selected quote (first occurrence). */
export function anchorFromQuote(fullText: string, quote: string): NoteCommentAnchor | null {
  const selectedText = quote.trim()
  if (!selectedText) return null
  const start = fullText.indexOf(selectedText)
  if (start < 0) return null
  return createNoteCommentAnchor({
    fullText,
    start,
    end: start + selectedText.length,
    selectedText,
  })
}
