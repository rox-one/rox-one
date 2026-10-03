import { describe, expect, it } from 'bun:test'
import { findMatchingPages } from '../pdf-search'

describe('findMatchingPages', () => {
  it('matches case-insensitively across normalized whitespace and compatibility characters', () => {
    expect(findMatchingPages([
      'A full-width ＴＥＳＴ\nphrase',
      'test phrase appears here',
      'unrelated text',
    ], '  test   phrase ')).toEqual([1, 2])
  })

  it('does not treat an empty query or textless pages as a match', () => {
    expect(findMatchingPages(['some content', ''], ' \n ')).toEqual([])
    expect(findMatchingPages(['', '   '], 'text')).toEqual([])
  })
})
