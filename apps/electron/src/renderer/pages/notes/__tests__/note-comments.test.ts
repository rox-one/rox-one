import { describe, expect, it } from 'bun:test'
import type { NoteCommentThread } from '../../../../shared/types'
import { createNoteCommentAnchor, resolveNoteCommentAnchor, resolveNoteCommentAnchors } from '../note-comments'

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
    const comment: NoteCommentThread = {
      id: 'c1',
      noteId: 'n1',
      author: 'Вы',
      body: 'Check this',
      anchor,
      createdAt: 1,
      updatedAt: 1,
    }

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
})
