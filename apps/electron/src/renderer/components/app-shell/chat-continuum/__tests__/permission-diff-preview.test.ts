import { describe, expect, it } from 'bun:test'
import { hunkLines } from '../PermissionDiffPreview'

describe('hunkLines', () => {
  it('maps old to removed and new to added lines', () => {
    expect(hunkLines('a\nb\n', 'c')).toEqual([{ sign: '-', text: 'a' }, { sign: '-', text: 'b' }, { sign: '+', text: 'c' }])
    expect(hunkLines('', 'x')).toEqual([{ sign: '+', text: 'x' }])
  })
})
