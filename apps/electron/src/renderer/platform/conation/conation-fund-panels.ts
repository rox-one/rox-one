/** Keep id aligned with workbench.conation.canvas (Fund deep-link pane). */
export const CONATION_FUND_PANEL_ID = 'conation.fund' as const

export const CONATION_FUND_DEEP_LINK = 'https://conation.dev' as const

export type FundPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  canvasEnabled: boolean
}

export type FundPanelContribution<C> = {
  id: typeof CONATION_FUND_PANEL_ID
  title: 'Conation Fund'
  component: C
}

export type FundPanelRegistry<C> = {
  register: (contribution: FundPanelContribution<C>) => void
}

export function shouldRegisterFundPanel(flags: FundPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.canvasEnabled === true
}

/** No-op unless shell + inspector + canvas are all on (all default false). */
export function registerFundPanel<C>(
  registry: FundPanelRegistry<C>,
  component: C,
  flags: FundPanelFlags,
): void {
  if (!shouldRegisterFundPanel(flags)) return
  registry.register({
    id: CONATION_FUND_PANEL_ID,
    title: 'Conation Fund',
    component,
  })
}
