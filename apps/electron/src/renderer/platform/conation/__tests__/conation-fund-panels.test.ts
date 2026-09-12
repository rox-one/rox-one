import { describe, expect, it } from 'bun:test'
import { createPanelRegistry } from '@craft-agent/core/platform'
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
        inspectorEnabled: false,
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
    const registry = createPanelRegistry()
    registerFundPanel(registry)
    registerFundPanel(registry, () => null, {
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: false,
    })
    expect(registry.get(CONATION_FUND_PANEL_ID)).toBeUndefined()
    expect(registry.list('inspector', {}).map((panel) => panel.id)).not.toContain(
      CONATION_FUND_PANEL_ID,
    )
  })

  it('registers conation.fund once when all flags are on', () => {
    const registry = createPanelRegistry()
    const render = () => null
    const registration = registerFundPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: true,
    })
    const duplicate = registerFundPanel(registry, render, {
      shellEnabled: true,
      inspectorEnabled: true,
      canvasEnabled: true,
    })

    expect(registry.get(CONATION_FUND_PANEL_ID)?.title).toBe('Conation Fund')
    expect(registry.get(CONATION_FUND_PANEL_ID)?.source.id).toBe('conation')
    expect(registry.get(CONATION_FUND_PANEL_ID)?.defaultOrder).toBe(41)
    expect(
      registry.list('inspector', {}).filter((panel) => panel.id === CONATION_FUND_PANEL_ID),
    ).toHaveLength(1)
    expect(registration).toBeDefined()
    expect(duplicate).toBeUndefined()
  })

  it('deep-links to conation.dev', () => {
    expect(CONATION_FUND_DEEP_LINK).toBe('https://conation.dev')
  })
})
