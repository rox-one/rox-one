import { describe, expect, it } from 'bun:test'
import { LOCALE_REGISTRY } from '../registry'
import {
  getLoadedLocaleCodes,
  i18n,
  preloadRendererLocales,
  resolveInitialLanguage,
  setupRendererI18n,
  startupLanguages,
} from '../lazy'

const storage = (value: string | null) => ({ getItem: () => value })

/** First dotted key whose string differs between two locales. */
function differingKey(a: Record<string, unknown>, b: Record<string, unknown>, prefix = ''): string | null {
  for (const [key, value] of Object.entries(a)) {
    const other = b[key]
    if (typeof value === 'string' && typeof other === 'string' && value !== other && !value.includes('{{')) return prefix + key
    if (value && typeof value === 'object' && other && typeof other === 'object') {
      const found = differingKey(value as Record<string, unknown>, other as Record<string, unknown>, `${prefix}${key}.`)
      if (found) return found
    }
  }
  return null
}

function valueAt(messages: unknown, key: string): unknown {
  const flat = (messages as Record<string, unknown>)[key]
  if (flat !== undefined) return flat
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)
}

describe('resolveInitialLanguage', () => {
  it('maps the persisted detector value like i18next best-match, defaulting to Russian', () => {
    expect(resolveInitialLanguage(storage(null))).toBe('ru')
    expect(resolveInitialLanguage(storage('en'))).toBe('en')
    expect(resolveInitialLanguage(storage('en-US'))).toBe('en')
    expect(resolveInitialLanguage(storage('zh'))).toBe('zh-Hans')
    expect(resolveInitialLanguage(storage('zh-Hant'))).toBe('zh-Hant')
    expect(resolveInitialLanguage(storage('xx'))).toBe('ru')
    expect(resolveInitialLanguage({ getItem: () => { throw new Error('denied') } })).toBe('ru')
  })

  it('preloads the active language plus the ru → en fallback chain only', () => {
    expect(startupLanguages('de')).toEqual(['de', 'ru', 'en'])
    expect(startupLanguages('en')).toEqual(['en', 'ru'])
    expect(startupLanguages('ru')).toEqual(['ru', 'en'])
  })
})

describe('setupRendererI18n', () => {
  it('translates synchronously from preloaded bundles and loads other locales on demand', async () => {
    await preloadRendererLocales(['ru', 'en'])
    expect(getLoadedLocaleCodes().sort()).toEqual(['en', 'ru'])

    const detector = { type: 'languageDetector' as const, init() {}, detect: () => 'ru', cacheUserLanguage() {} }
    const instance = setupRendererI18n([detector])
    expect(instance).toBe(i18n)
    expect(instance.language).toBe('ru')

    const ruMessages = LOCALE_REGISTRY.ru.messages as unknown as Record<string, unknown>
    const deMessages = LOCALE_REGISTRY.de.messages as unknown as Record<string, unknown>
    const key = differingKey(ruMessages, deMessages)
    expect(key).not.toBeNull()
    // Synchronous t() right after setup, before any await.
    expect(instance.t(key!)).toBe(valueAt(ruMessages, key!) as string)

    await instance.changeLanguage('de')
    expect(instance.language).toBe('de')
    expect(instance.t(key!)).toBe(valueAt(deMessages, key!) as string)
    expect(getLoadedLocaleCodes()).toContain('de')
    expect(getLoadedLocaleCodes()).not.toContain('ja')
  })
})
