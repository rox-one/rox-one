export const UI_FONTS = ['rox', 'inter', 'system'] as const
export const CHAT_FONTS = ['rox', 'inter', 'system'] as const
export const TERMINAL_FONTS = ['rox', 'jetbrains', 'system'] as const

export type UiFontFamily = (typeof UI_FONTS)[number]
export type ChatFontFamily = (typeof CHAT_FONTS)[number]
export type TerminalFontFamily = (typeof TERMINAL_FONTS)[number]

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** Fresh installs use the embedded Rox face. */
export function normalizeUiFont(value: unknown, fallback: UiFontFamily = 'rox'): UiFontFamily {
  return isOneOf(value, UI_FONTS) ? value : fallback
}

export function normalizeChatFont(value: unknown, fallback: ChatFontFamily = 'rox'): ChatFontFamily {
  return isOneOf(value, CHAT_FONTS) ? value : fallback
}

export function normalizeTerminalFont(
  value: unknown,
  fallback: TerminalFontFamily = 'rox',
): TerminalFontFamily {
  return isOneOf(value, TERMINAL_FONTS) ? value : fallback
}

/**
 * Pre-triad storage only had `font`, defaulting to `system` while the stack
 * was still SF-first. Map that legacy default to Rox so existing installs
 * keep the same look; an explicit later `system` choice (chatFont present)
 * stays system.
 */
export function resolveStoredUiFont(
  stored: { font?: unknown; chatFont?: unknown } | null | undefined,
  fallback: UiFontFamily = 'rox',
): UiFontFamily {
  const legacy = stored == null || stored.chatFont === undefined
  if (legacy && stored?.font === 'system') return 'rox'
  return normalizeUiFont(stored?.font, fallback)
}
