import { describe, expect, it } from 'bun:test'
import {
  CONATION_FUND_DEEP_LINK,
  CONATION_FUND_PANEL_ID,
  registerFundPanel,
  shouldRegisterFundPanel,
} from '../conation-fund-panels.ts'

describe('registerFundPanel', () => {
  it('is off unless shell, inspector, and canvas are all on', () => {
    expect(
      shouldRegisterFundPanel({
        shellEnabled: false,
        inspectorEnabled: true,
        canvasEnabled: true,
      }),
    ).toBe(false)
    expect(
      shouldRegisterFundPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        canvasEnabled: false,
      }),
    ).toBe(false)
    expect(
      shouldRegisterFundPanel({
        shellEnabled: true,
        inspectorEnabled: true,
        canvasEnabled: true,
      }),
    ).toBe(true)
  })

  it('does not register when canvas flag is off', () => {
    const calls: unknown[] = []
    registerFundPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: false,
    })
    expect(calls).toEqual([])
  })

  it('registers conation.fund when all flags on', () => {
    const calls: Array<{ id: string; title: string }> = []
    registerFundPanel({ register: (c) => calls.push(c) }, { name: 'Panel' }, {
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.id).toBe(CONATION_FUND_PANEL_ID)
    expect(calls[0]?.title).toBe('Conation Fund')
  })

  it('deep-links to conation.dev', () => {
    expect(CONATION_FUND_DEEP_LINK).toBe('https://conation.dev')
  })
})
