import { describe, expect, it } from 'bun:test'
import {
  createCommandRegistry,
  createContextKeyService,
  evaluateWhen,
  WORKBENCH_FLAG,
} from '@craft-agent/core/platform'
import { CONATION_BOARD_DEEP_LINK } from '../conation/conation-board-panels'
import { CONATION_FUND_DEEP_LINK } from '../conation/conation-fund-panels'
import {
  CONATION_OPEN_BOARD_COMMAND_ID,
  CONATION_OPEN_FUND_COMMAND_ID,
  boardCommandWhen,
  createConationContextKeyProvider,
  fundCommandWhen,
  registerConationOmniboxCommands,
  shouldShowBoardCommand,
  shouldShowFundCommand,
} from '../omnibox-conation'

const OFF: Parameters<typeof shouldShowFundCommand>[0] & { boardEnabled: boolean } = {
  shellEnabled: false,
  inspectorEnabled: false,
  canvasEnabled: false,
  boardEnabled: false,
}

describe('conation omnibox commands', () => {
  it('stays hidden while workbench.conation flags default off', () => {
    expect(shouldShowFundCommand(OFF)).toBe(false)
    expect(shouldShowBoardCommand(OFF)).toBe(false)

    const registry = createCommandRegistry()
    registerConationOmniboxCommands(registry, {
      fundTitle: 'Open Fund in Conation',
      boardTitle: 'Open Board in Conation',
      category: 'Conation',
    })
    const keys = createConationContextKeyProvider(() => OFF).pull()
    const hits = registry.query({}, keys)
    expect(hits.some((c) => c.id === CONATION_OPEN_FUND_COMMAND_ID)).toBe(false)
    expect(hits.some((c) => c.id === CONATION_OPEN_BOARD_COMMAND_ID)).toBe(false)
  })

  it('shows Fund only when shell + inspector + canvas are on', () => {
    const registry = createCommandRegistry()
    registerConationOmniboxCommands(registry, {
      fundTitle: 'Open Fund in Conation',
      boardTitle: 'Open Board in Conation',
      category: 'Conation',
    })
    const keys = createConationContextKeyProvider(() => ({
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: true,
      boardEnabled: false,
    })).pull()
    const hits = registry.query({}, keys)
    expect(hits.some((c) => c.id === CONATION_OPEN_FUND_COMMAND_ID)).toBe(true)
    expect(hits.some((c) => c.id === CONATION_OPEN_BOARD_COMMAND_ID)).toBe(false)
    expect(evaluateWhen(fundCommandWhen(), keys)).toBe(true)
    expect(evaluateWhen(boardCommandWhen(), keys)).toBe(false)
  })

  it('shows Board only when shell + inspector + board are on', () => {
    const registry = createCommandRegistry()
    registerConationOmniboxCommands(registry, {
      fundTitle: 'Open Fund in Conation',
      boardTitle: 'Open Board in Conation',
      category: 'Conation',
    })
    const keys = createConationContextKeyProvider(() => ({
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: false,
      boardEnabled: true,
    })).pull()
    const hits = registry.query({ text: 'board' }, keys)
    expect(hits.some((c) => c.id === CONATION_OPEN_BOARD_COMMAND_ID)).toBe(true)
    expect(hits.some((c) => c.id === CONATION_OPEN_FUND_COMMAND_ID)).toBe(false)
  })

  it('opens the Conation deep link on execute', async () => {
    const opened: string[] = []
    const registry = createCommandRegistry()
    registerConationOmniboxCommands(registry, {
      fundTitle: 'Open Fund in Conation',
      boardTitle: 'Open Board in Conation',
      category: 'Conation',
      openUrl: (url) => {
        opened.push(url)
      },
    })
    const keys = createContextKeyService()
    await registry.get(CONATION_OPEN_FUND_COMMAND_ID)?.execute({ keys: keys.snapshot() })
    await registry.get(CONATION_OPEN_BOARD_COMMAND_ID)?.execute({ keys: keys.snapshot() })
    expect(opened).toEqual([CONATION_FUND_DEEP_LINK, CONATION_BOARD_DEEP_LINK])
  })

  it('uses locked workbench.conation.* ids in when clauses', () => {
    expect(fundCommandWhen()).toContain(WORKBENCH_FLAG.conationCanvas)
    expect(boardCommandWhen()).toContain(WORKBENCH_FLAG.conationBoard)
  })
})
