import type { PanelContribution, PanelRegistry, PanelRenderer } from '@craft-agent/core/platform'

/** Keep id aligned with workbench.conation.board (Board deep-link pane). */
export const CONATION_BOARD_PANEL_ID = 'conation.board' as const

export const CONATION_BOARD_DEEP_LINK = 'https://conation.dev' as const

export type BoardPanelFlags = {
  shellEnabled: boolean
  inspectorEnabled: boolean
  boardEnabled: boolean
}

export function shouldRegisterBoardPanel(flags: BoardPanelFlags): boolean {
  return flags.shellEnabled === true && flags.inspectorEnabled === true && flags.boardEnabled === true
}

export function boardPanelContribution(
  render: PanelRenderer,
  title = 'Conation Board',
): PanelContribution {
  return {
    id: CONATION_BOARD_PANEL_ID,
    title,
    icon: 'layers',
    slot: 'inspector',
    defaultOrder: 42,
    defaultVisible: true,
    resizable: true,
    source: { type: 'core', id: 'conation' },
    render,
  }
}

/** No-op unless shell + inspector + board are all on (all default false). */
export function registerBoardPanel(
  registry: PanelRegistry,
  render: PanelRenderer = () => null,
  flags: BoardPanelFlags = {
    shellEnabled: false,
    inspectorEnabled: false,
    boardEnabled: false,
  },
  title = 'Conation Board',
): ReturnType<PanelRegistry['register']> | undefined {
  if (!shouldRegisterBoardPanel(flags)) return
  if (registry.get(CONATION_BOARD_PANEL_ID)) return
  return registry.register(boardPanelContribution(render, title))
}
