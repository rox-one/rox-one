import type { i18n } from 'i18next'

/** Mirror renderer language into optional main-process preferences. */
export function syncMainProcessLanguage(
  language: Pick<i18n, 'resolvedLanguage' | 'language' | 'on' | 'off'>,
  api: Pick<Window['electronAPI'], 'changeLanguage'> | undefined,
): () => void {
  const sync = async (value: string | undefined) => {
    if (!value) return
    try {
      await api?.changeLanguage?.(value)
    } catch {
      // A thin/native caller can render its language without host preferences.
    }
  }
  const changed = (value: string) => { void sync(value) }
  void sync(language.resolvedLanguage || language.language)
  language.on('languageChanged', changed)
  return () => { language.off('languageChanged', changed) }
}
