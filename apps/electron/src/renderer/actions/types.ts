export type ActionScope = 'global' | 'navigator' | 'chat' | 'sidebar'

export interface ActionDefinition {
  id: string
  labelKey: string
  description?: string
  defaultHotkey: string | null  // null = no default hotkey
  category: string
  scope?: ActionScope           // Default: 'global'
  /** When-clause expression controlling when the action fires.
   *  Omit = fires everywhere (default). Examples:
   *  - '!inputFocus'              — only outside text inputs
   *  - 'chatFocus && !hasSelection' — chat zone, no text selected
   *  - 'navigatorFocus'           — only when navigator is focused
   *  @see evaluateWhen() in keybinding-context.ts */
  when?: string
  /** W1-07 (#1504): Windows/Linux chord when it must differ from the macOS
   *  `defaultHotkey` (e.g. ⌃1 on macOS is Ctrl+1 = mod+1 elsewhere). */
  defaultHotkeyNonMac?: string | null
  /** W1-07 (#1504): workbench flag id. While it is off the action has no
   *  hotkey, is not listed and never intercepts a key. */
  flag?: string
}

export type ActionId = keyof typeof import('./definitions').actions

export interface ActionHandler {
  actionId: ActionId
  handler: () => void
  enabled?: () => boolean
  /**
   * Higher wins when several enabled handlers match (default 0). Lets a
   * mounted screen take over a global hotkey while it applies (e.g. ⌘N on
   * Задачи opens Quick Entry instead of a new chat).
   */
  priority?: number
}
