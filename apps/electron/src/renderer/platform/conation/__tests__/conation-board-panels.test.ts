import { describe, expect, it } from 'bun:test'
import { createPanelRegistry } from '@craft-agent/core/platform'
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
        inspectorEnabled: false,
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
    const registry = createPanelRegistry()
    registerBoardPanel(registry)
    registerBoardPanel(registry, () => null, {
      shellEnabled: true,
      inspectorEnabled: true,
      boardEnabled: false,
    })
    expect(registry.get(CONATION_BOARD_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((panel) => panel.id)).not.toContain(
      CONATION_BOARD_PANEL_ID,
    )
  })

  it('registers conation.board once when all flags are on', () => {
    const registry = createPanelRegistry()
    const render = () => null
    const registration = registerBoardPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      boardEnabled: true,
    })
    const duplicate = registerBoardPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      boardEnabled: true,
    })

    expect(registry.get(CONATION_BOARD_PANEL_ID)?.title).toBe('Conation Board')
    expect(registry.get(CONATION_BOARD_PANEL_ID)?.source.id).toBe('conation')
    expect(registry.get(CONATION_BOARD_PANEL_ID)?.defaultOrder).toBe(42)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_BOARD_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()
  })

  it('deep-links to conation.dev', () => {
    expect(CONATION_BOARD_DEEP_LINK).toBe('https://conation.dev')
  })
})
