/**
 * Wave 13 (SPEC §F2): unit tests for the pure find & replace core.
 *
 * The module holds the offset arithmetic the surface's find panel relies on, so
 * the cases here are the contract itself: an empty query matches nothing,
 * matching is case-insensitive by default but offset-exact, a multi-line query
 * is a plain substring, matches never overlap, and `replaceAllInSources`
 * returns only the cells it changed with the right total.
 */
import { describe, expect, it } from 'bun:test'
import { computeMatches, replaceAllInSources, replaceMatch, type CookbooksFindMatch } from '../find-replace'

describe('computeMatches', () => {
  it('an empty query matches nothing', () => {
    expect(computeMatches(['print(1)', 'x = 2'], '', false)).toEqual([])
    expect(computeMatches(['print(1)'], '', true)).toEqual([])
  })

  it('finds every occurrence across cells, in document order', () => {
    const matches = computeMatches(['print(1)', 'print(2)', 'no match'], 'print', false)
    expect(matches).toEqual<CookbooksFindMatch[]>([
      { cell: 0, start: 0, end: 5 },
      { cell: 1, start: 0, end: 5 },
    ])
  })

  it('is case-insensitive by default and offset-exact, then case-sensitive on demand', () => {
    const insensitive = computeMatches(['Print(1)'], 'print', false)
    expect(insensitive).toEqual<CookbooksFindMatch[]>([{ cell: 0, start: 0, end: 5 }])
    // Offsets stay against the ORIGINAL source, not the lowercased haystack.
    expect(insensitive[0].start).toBe(0)
    expect(computeMatches(['Print(1)'], 'print', true)).toEqual([])
    expect(computeMatches(['print(1)'], 'print', true)).toEqual<CookbooksFindMatch[]>([{ cell: 0, start: 0, end: 5 }])
  })

  it('treats a multi-line query as a plain substring', () => {
    const matches = computeMatches(['a = 1\nb = 2'], '1\nb', false)
    expect(matches).toEqual<CookbooksFindMatch[]>([{ cell: 0, start: 4, end: 7 }])
  })

  it('never overlaps matches — the scan steps by the query length', () => {
    // 'aa' in 'aaaa' yields two non-overlapping hits, not three.
    expect(computeMatches(['aaaa'], 'aa', true)).toEqual<CookbooksFindMatch[]>([
      { cell: 0, start: 0, end: 2 },
      { cell: 0, start: 2, end: 4 },
    ])
  })

  it('skips undefined and empty sources', () => {
    expect(computeMatches([undefined, '', 'x'], 'x', false)).toEqual<CookbooksFindMatch[]>([{ cell: 2, start: 0, end: 1 }])
  })
})

describe('replaceMatch', () => {
  it('replaces exactly the [start, end) span', () => {
    expect(replaceMatch('print(1)', 0, 5, 'echo')).toBe('echo(1)')
    expect(replaceMatch('print(1)', 6, 7, '42')).toBe('print(42)')
  })

  it('inserts when the span is empty', () => {
    expect(replaceMatch('ab', 1, 1, 'X')).toBe('aXb')
  })
})

describe('replaceAllInSources', () => {
  it('counts every replacement and returns only the changed cells', () => {
    const { updates, count } = replaceAllInSources(['print(1) print(2)', 'no hit'], 'print', 'echo', false)
    expect(count).toBe(2)
    expect(updates).toEqual<Record<number, string>>({ 0: 'echo(1) echo(2)' })
  })

  it('an empty query is a no-op', () => {
    expect(replaceAllInSources(['a', 'b'], '', 'X', false)).toEqual({ updates: {}, count: 0 })
  })

  it('honours case sensitivity', () => {
    expect(replaceAllInSources(['Print print'], 'print', 'X', true)).toEqual({ updates: { 0: 'Print X' }, count: 1 })
    expect(replaceAllInSources(['Print print'], 'print', 'X', false)).toEqual({ updates: { 0: 'X X' }, count: 2 })
  })

  it('rewrites a multi-line cell in one pass', () => {
    expect(replaceAllInSources(['a\nb\na\nb'], 'a', 'z', true)).toEqual({ updates: { 0: 'z\nb\nz\nb' }, count: 2 })
  })
})
