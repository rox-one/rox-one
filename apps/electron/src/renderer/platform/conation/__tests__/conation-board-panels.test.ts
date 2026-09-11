import { describe, expect, it } from 'bun:test'
import {
  CONATION_BOARD_DEEP_LINK,
  CONATION_BOARD_PANEL_ID,
  registerBoardPanel,
  shouldRegisterBoardPanel,
} from '../conation-board-panels.ts'

describe('registerBoardPanel', () => {
  it('is off unless shell, inspector, and board are all on', () => {
    expect(
      shouldRegisterBoardPanel({
        shellEnabled: false,
        inspectorEnabled: true,
        boardEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterBoardPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        boardEnabled: false,
      }),
    ).toBe(false)
    expect(
      shouldRegisterBoardPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        boardEnabled: true,
      }),
    ).toBe(true)
  })

  it('does not register when board flag is off', () => {
    const calls: unknown[] = []
    registerBoardPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      boardEnabled: false,
    })
    expect(calls).toEqual([])
  })

  it('registers conation.board when all flags on', () => {
    const calls: Array<{ id: string; title: string }> = []
    registerBoardPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      boardEnabled: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.id).toBe(CONATION_BOARD_PANEL_ID)
    expect(calls[0]?.title).toBe('Conation Board')
  })

  it('deep-links to conation.dev', () => {
    expect(CONATION_BOARD_DEEP_LINK).toBe('https://conation.dev')
  })
})
