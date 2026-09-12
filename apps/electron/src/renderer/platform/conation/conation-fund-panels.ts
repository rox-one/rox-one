import type { PanelContribution, PanelRegistry, PanelRenderer } from '@craft-agent/core/platform'

/** Keep id aligned with workbench.conation.canvas (Fund deep-link pane). */
export const CONATION_FUND_PANEL_ID = 'conation.fund' as const

export const CONATION_FUND_DEEP_LINK = 'https://conation.dev' as const

export type FundPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  canvasEnabled: boolean
}

export function shouldRegisterFundPanel(flags: FundPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.canvasEnabled === true
}

export function fundPanelContribution(
  render: PanelRenderer,
  title = 'Conation Fund',
): PanelContribution {
  return {
    id: CONATION_FUND_PANEL_ID,
    title,
    icon: 'layers',
    slot: 'inspector',
    defaultOrder: 41,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'conation' },
    render,
  }
}

/** No-op unless shell + inspector + canvas are all on (all default false). */
export function registerFundPanel(
  registry: PanelRegistry,
  render: PanelRenderer = () => null,
  flags: FundPanelFlags = {
    shellEnabled: false,
    inspectorEnabled: false,
    canvasEnabled: false,
  },
  title = 'Conation Fund',
): ReturnType<PanelRegistry['register']> | undefined {
  if (!shouldRegisterFundPanel(flags)) return
  if (registry.get(CONATION_FUND_PANEL_ID)) return
  return registry.register(fundPanelContribution(render, title))
}
