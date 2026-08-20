import { describe, expect, it } from 'bun:test'
import { boardCardRoute, sessionRowClickTarget } from '../session-row-click'

describe('sessionRowClickTarget', () => {
  it('sends title/row clicks to chat and status clicks to the board card', () => {
    expect(sessionRowClickTarget('row')).toBe('chat')
    expect(sessionRowClickTarget('status')).toBe('board')
  })
})

describe('boardCardRoute', () => {
  it('encodes board/session/{id}', () => {
    expect(boardCardRoute('260806-young-brook')).toBe('board/session/260806-young-brook')
  })
})
