/**
 * Rox History palette command — opens the clipboard history screen from the
 * omnibox (⌘K). The rail item stays the primary surface; this is the launcher
 * entry point the task requires («История буфера» in the launcher).
 */
import type { CommandContribution, CommandRegistry } from '@rox/core/platform'
import { navigate, routes } from '@/lib/navigate'

export const CLIPBOARD_HISTORY_OPEN_COMMAND_ID = 'clipboardHistory.open' as const

export function clipboardHistoryCommand(options: {
  title: string
  category: string
}): CommandContribution {
  return {
    id: CLIPBOARD_HISTORY_OPEN_COMMAND_ID,
    title: options.title,
    category: options.category,
    source: 'craft',
    keywords: ['clipboard', 'буфер', 'история'],
    async execute() {
      navigate(routes.view.clipboardHistory())
    },
  }
}

export function registerClipboardHistoryOmniboxCommands(
  commands: CommandRegistry,
  options: { title: string; category: string },
): Array<{ dispose(): void }> {
  return [commands.register(clipboardHistoryCommand(options))]
}