import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'rail.collapse'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-278 leftover рейку wrapping on rail.collapse', () => {
  it('wraps leftover рейку as панель in Russian, matching workspaceIconRail sibling', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Свернуть панель активности')
    expect(ru[KEY]).not.toMatch(/рейк/i)
    expect(ru['settings.appearance.workspaceIconRail']).toMatch(/Панель/i)
  })

  it('keeps English rail as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Collapse activity rail')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Свернуть панель активности')
    expect(i18n.t(KEY)).not.toBe('Collapse activity rail')
    expect(i18n.t(KEY)).not.toMatch(/рейк/i)
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Collapse activity rail')
  })

  it('defines the key in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, file).toBeGreaterThan(0)
    }
  })
})
