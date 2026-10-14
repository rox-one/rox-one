import { describe, expect, it } from 'bun:test'
import { extractNoteTaskLines } from '../note-tasks'

describe('#1574 extractNoteTaskLines', () => {
  it('matches the Notes page grammar (dash/star, x/X, CRLF, 1-based lines)', () => {
    expect(extractNoteTaskLines('# T\r\n- [ ] a\r\n  * [X] b \nnot - [ ] c\n- [] d')).toEqual([
      { line: 2, text: 'a', checked: false },
      { line: 3, text: 'b', checked: true },
    ])
  })
})
