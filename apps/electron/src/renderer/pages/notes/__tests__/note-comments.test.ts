import { describe, expect, it } from 'bun:test'
import type { NoteCommentThread } from '../../../../shared/types'
import {
  anchorFromQuote,
  createNoteCommentAnchor,
  isDocumentNoteComment,
  nestNoteCommentThreads,
  noteThreadsToHighlightComments,
  removeNoteCommentFromList,
  resolveNoteCommentAnchor,
  resolveNoteCommentAnchors,
  upsertNoteCommentInList,
} from '../note-comments'

function thread(partial: Partial<NoteCommentThread> & Pick<NoteCommentThread, 'id' | 'body'>): NoteCommentThread {
  return {
    noteId: 'n1',
    author: 'Вы',
    anchor: null,
    reactions: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('note comment anchors', () => {
  it('creates a text-position plus text-quote anchor from a selection', () => {
    const fullText = 'Intro\nImportant sentence\nOutro'
    const selectedText = 'Important sentence'
    const start = fullText.indexOf(selectedText)
    const anchor = createNoteCommentAnchor({
      fullText,
      start,
      end: start + selectedText.length,
      selectedText,
    })

    expect(anchor?.selectedText).toBe(selectedText)
    expect(anchor?.selectors.some(selector => selector.type === 'text-position')).toBe(true)
    expect(anchor?.selectors.some(selector => selector.type === 'text-quote')).toBe(true)
  })

  it('falls back to quote matching when text position shifted', () => {
    const fullText = 'Alpha\nTarget phrase\nOmega'
    const target = 'Target phrase'
    const start = fullText.indexOf(target)
    const anchor = createNoteCommentAnchor({ fullText, start, end: start + target.length, selectedText: target })
    expect(anchor).not.toBeNull()

    const shiftedText = `Preface\n${fullText}`
    const resolved = resolveNoteCommentAnchor(shiftedText, anchor!)

    expect(resolved.stale).toBe(false)
    expect(shiftedText.slice(resolved.start!, resolved.end!)).toBe(target)
  })

  it('marks a comment anchor as stale when neither position nor quote resolves', () => {
    const anchor = createNoteCommentAnchor({
      fullText: 'Alpha Target Omega',
      start: 6,
      end: 12,
      selectedText: 'Target',
    })!
    const comment = thread({ id: 'c1', body: 'Check this', anchor })

    expect(resolveNoteCommentAnchors('Alpha Removed Omega', [comment]).c1.stale).toBe(true)
  })

  it('flags a pending comment selection as stale when the selected text was replaced before create', () => {
    const anchor = createNoteCommentAnchor({
      fullText: 'Alpha Target Omega',
      start: 6,
      end: 12,
      selectedText: 'Target',
    })!

    const resolved = resolveNoteCommentAnchor('Alpha Changed Omega', anchor)

    expect(resolved).toEqual({ start: null, end: null, stale: true })
  })

  it('treats a null anchor as a non-stale whole-document comment', () => {
    expect(resolveNoteCommentAnchor('any text', null)).toEqual({ start: null, end: null, stale: false })
    expect(isDocumentNoteComment(thread({ id: 'doc', body: 'About the note' }))).toBe(true)
    expect(isDocumentNoteComment(thread({
      id: 'sel',
      body: 'Inline',
      anchor: createNoteCommentAnchor({ fullText: 'Alpha Target', start: 6, end: 12, selectedText: 'Target' }),
    }))).toBe(false)
  })

  it('builds an anchor from the first quote occurrence in note text', () => {
    const anchor = anchorFromQuote('One Target Two Target', 'Target')
    expect(anchor?.selectedText).toBe('Target')
    expect(anchor?.selectors.find(s => s.type === 'text-position')).toMatchObject({ start: 4, end: 10 })
  })

  it('prefers explicit selection offsets when the quote repeats in the note', () => {
    const fullText = 'One Target Two Target'
    const second = fullText.indexOf('Target', 5)
    const anchor = anchorFromQuote(fullText, 'Target', { start: second, end: second + 6 })
    expect(anchor?.selectors.find(s => s.type === 'text-position')).toMatchObject({ start: second, end: second + 6 })
  })

  it('nests flat comments into one-level threads and resurfaces orphan replies', () => {
    const nested = nestNoteCommentThreads([
      thread({ id: 'r1', body: 'Root', createdAt: 2, updatedAt: 2 }),
      thread({ id: 'a1', body: 'Reply', parentId: 'r1', createdAt: 3, updatedAt: 3 }),
      thread({ id: 'orphan', body: 'Lost', parentId: 'missing', createdAt: 1, updatedAt: 1 }),
      thread({ id: 'r0', body: 'Earlier', createdAt: 1, updatedAt: 1 }),
    ])
    expect(nested.map(item => item.id)).toEqual(['r0', 'orphan', 'r1'])
    expect(nested.find(item => item.id === 'r1')!.replies.map(item => item.id)).toEqual(['a1'])
    const orphan = nested.find(item => item.id === 'orphan')!
    expect(orphan.orphan).toBe(true)
    expect(orphan.parentId).toBe('missing')
    expect(isDocumentNoteComment(orphan)).toBe(false)
  })

  it('upserts and removes comments without dropping concurrent siblings', () => {
    const a = thread({ id: 'a', body: 'A', createdAt: 1, updatedAt: 1 })
    const b = thread({ id: 'b', body: 'B', createdAt: 2, updatedAt: 2 })
    const b2 = { ...b, body: 'B2', updatedAt: 3 }
    expect(upsertNoteCommentInList([a], b).map(c => c.id)).toEqual(['a', 'b'])
    expect(upsertNoteCommentInList([a, b], b2).map(c => c.body)).toEqual(['A', 'B2'])
    const reply = thread({ id: 'r', body: 'R', parentId: 'a', createdAt: 3, updatedAt: 3 })
    expect(removeNoteCommentFromList([a, b, reply], 'a').map(c => c.id)).toEqual(['b'])
  })
})

describe('noteThreadsToHighlightComments', () => {
  it('excludes resolved threads from editor highlights', () => {
    const full = 'Alpha quoted open Omega quoted done'
    const openAnchor = createNoteCommentAnchor({
      fullText: full,
      start: full.indexOf('quoted open'),
      end: full.indexOf('quoted open') + 'quoted open'.length,
      selectedText: 'quoted open',
    })
    const doneAnchor = createNoteCommentAnchor({
      fullText: full,
      start: full.indexOf('quoted done'),
      end: full.indexOf('quoted done') + 'quoted done'.length,
      selectedText: 'quoted done',
    })
    const open = thread({ id: 'open', body: 'Still open', anchor: openAnchor })
    const resolved = thread({ id: 'done', body: 'Resolved', resolvedAt: 99, anchor: doneAnchor })
    const reply = thread({ id: 'reply', body: 'reply', parentId: 'open', anchor: openAnchor })
    expect(noteThreadsToHighlightComments([open, resolved, reply])).toEqual([
      { id: 'open', quote: 'quoted open', body: 'Still open', createdAt: 1 },
    ])
  })
})
