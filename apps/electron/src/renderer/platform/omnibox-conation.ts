/**
 * Fund / Board palette commands (ROX-009 / ROX-010 leftovers).
 *
 * Hidden unless shell + inspector + the matching canvas/board flag are on
 * (all default false). Execute opens the same Conation deep link as the
 * inspector panes — no live in-app canvas/kanban.
 */
import {
  WORKBENCH_FLAG,
  type CommandContribution,
  type CommandRegistry,
  type ContextKeyProvider,
} from '@craft-agent/core/platform'
import {
  CONATION_FUND_DEEP_LINK,
  shouldRegisterFundPanel,
  type FundPanelFlags,
} from './conation/conation-fund-panels'
import {
  CONATION_BOARD_DEEP_LINK,
  shouldRegisterBoardPanel,
  type BoardPanelFlags,
} from './conation/conation-board-panels'

export const CONATION_OPEN_FUND_COMMAND_ID = 'conation.openFund' as const
export const CONATION_OPEN_BOARD_COMMAND_ID = 'conation.openBoard' as const

export type ConationPaletteFlags = FundPanelFlags & Pick<BoardPanelFlags, 'boardEnabled'>

export function fundCommandWhen(): string {
  return `${WORKBENCH_FLAG.conationShell} && ${WORKBENCH_FLAG.conationInspector} && ${WORKBENCH_FLAG.conationCanvas}`
}

export function boardCommandWhen(): string {
  return `${WORKBENCH_FLAG.conationShell} && ${WORKBENCH_FLAG.conationInspector} && ${WORKBENCH_FLAG.conationBoard}`
}

export function createConationContextKeyProvider(
  pullFlags: () => ConationPaletteFlags,
): ContextKeyProvider {
  return {
    keys: [
      WORKBENCH_FLAG.conationShell,
      WORKBENCH_FLAG.conationInspector,
      WORKBENCH_FLAG.conationCanvas,
      WORKBENCH_FLAG.conationBoard,
    ],
    pull() {
      const flags = pullFlags()
      return {
        [WORKBENCH_FLAG.conationShell]: flags.shellEnabled === true,
        [WORKBENCH_FLAG.conationInspector]: flags.inspectorEnabled === true,
        [WORKBENCH_FLAG.conationCanvas]: flags.canvasEnabled === true,
        [WORKBENCH_FLAG.conationBoard]: flags.boardEnabled === true,
      }
    },
  }
}

type OpenUrl = (url: string) => Promise<unknown> | unknown

function openDeepLink(url: string, openUrl?: OpenUrl): Promise<void> {
  if (!openUrl) return Promise.resolve()
  return Promise.resolve(openUrl(url)).then(() => undefined)
}

export function conationFundCommand(options: {
  title: string
  category: string
  openUrl?: OpenUrl
}): CommandContribution {
  return {
    id: CONATION_OPEN_FUND_COMMAND_ID,
    title: options.title,
    category: options.category,
    source: 'craft',
    when: fundCommandWhen(),
    keywords: ['fund', 'canvas', 'conation'],
    async execute() {
      await openDeepLink(CONATION_FUND_DEEP_LINK, options.openUrl)
    },
  }
}

export function conationBoardCommand(options: {
  title: string
  category: string
  openUrl?: OpenUrl
}): CommandContribution {
  return {
    id: CONATION_OPEN_BOARD_COMMAND_ID,
    title: options.title,
    category: options.category,
    source: 'craft',
    when: boardCommandWhen(),
    keywords: ['board', 'kanban', 'conation'],
    async execute() {
      await openDeepLink(CONATION_BOARD_DEEP_LINK, options.openUrl)
    },
  }
}

export function registerConationOmniboxCommands(
  commands: CommandRegistry,
  options: {
    fundTitle: string
    boardTitle: string
    category: string
    openUrl?: OpenUrl
  },
): Array<{ dispose(): void }> {
  return [
    commands.register(conationFundCommand({
      title: options.fundTitle,
      category: options.category,
      openUrl: options.openUrl,
    })),
    commands.register(conationBoardCommand({
      title: options.boardTitle,
      category: options.category,
      openUrl: options.openUrl,
    })),
  ]
}

export function shouldShowFundCommand(flags: FundPanelFlags): boolean {
  return shouldRegisterFundPanel(flags)
}

export function shouldShowBoardCommand(flags: BoardPanelFlags): boolean {
  return shouldRegisterBoardPanel(flags)
}
