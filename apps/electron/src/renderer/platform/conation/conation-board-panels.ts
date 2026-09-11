/** Keep id aligned with workbench.conation.board (Board deep-link pane). */
export const CONATION_BOARD_PANEL_ID = 'conation.board' as const

export const CONATION_BOARD_DEEP_LINK = 'https://conation.dev' as const

export type BoardPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  boardEnabled: boolean
}

export type BoardPanelContribution<C> = {
  id: typeof CONATION_BOARD_PANEL_ID
  title: 'Conation Board'
  component: C
}

export type BoardPanelRegistry<C> = {
  register: (contribution: BoardPanelContribution<C>) => void
}

export function shouldRegisterBoardPanel(flags: BoardPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.boardEnabled === true
}

/** No-op unless shell + inspector + board are all on (all default false). */
export function registerBoardPanel<C>(
  registry: BoardPanelRegistry<C>,
  component: C,
  flags: BoardPanelFlags,
): void {
  if (!shouldRegisterBoardPanel(flags)) return
  registry.register({
    id: CONATION_BOARD_PANEL_ID,
    title: 'Conation Board',
    component,
  })
}
