import type { ThemeFile } from '@config/theme'

/** Sanitized `data-ui-profile` value from a preset theme file, if any. */
export function resolveUiProfile(preset: ThemeFile | null | undefined): string | undefined {
  const raw = preset?.uiProfile
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed || !/^[a-z0-9-]+$/.test(trimmed)) return undefined
  return trimmed
}

/** Palette mode is separate from requested/system mode and window material. */
export function resolveVisualMode(
  requested: 'light' | 'dark',
  supported: readonly ('light' | 'dark')[] | undefined,
  scenic: boolean,
): 'light' | 'dark' {
  if (scenic) return 'dark'
  if (supported?.length === 1) return supported[0]!
  return requested
}

/** Commit local state/broadcast only after the existing configuration API. */
export async function persistThemeSelection(
  themeId: string,
  persist: ((themeId: string) => Promise<void>) | undefined,
  commit: () => void,
): Promise<void> {
  if (persist) await persist(themeId)
  commit()
}
