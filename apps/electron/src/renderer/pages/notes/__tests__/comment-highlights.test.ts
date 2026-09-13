import { describe, expect, test } from 'bun:test'
import { commentsForQuote, quoteOffsets, selectionComposerOffset } from '../comment-highlights'

describe('note comment highlights', () => {
  test('finds quoted spans and matches comments', () => {
    expect(quoteOffsets('alpha beta alpha', 'alpha')).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 },
    ])
    const comments = [
      { id: 'c1', quote: 'alpha', body: 'look' },
      { id: 'c2', quote: 'zzz', body: 'nope' },
    ]
    expect(commentsForQuote(comments, 'alpha').map((item) => item.id)).toEqual(['c1'])
  })

  test('pins the composer to selection height inside the editor', () => {
    expect(selectionComposerOffset(120, 100, 400)).toBe(20)
    expect(selectionComposerOffset(10, 100, 400)).toBe(8)
    expect(selectionComposerOffset(900, 100, 200, 80)).toBe(112)
  })
})
