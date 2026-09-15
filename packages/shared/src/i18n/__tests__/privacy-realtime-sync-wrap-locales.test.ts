import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.privacy.realtimeSyncDesc'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-276 leftover реплики wrapping on settings.privacy.realtimeSyncDesc', () => {
  it('wraps leftover реплики as копии in Russian, matching accountReplica sibling', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Отправлять изменения копии во время работы. Отзыв не удаляет локальные данные.')
    expect(ru[KEY]).not.toMatch(/реплик/i)
    expect(ru['accountReplica.deletionComplete']).toContain('копия')
  })

  it('keeps English replica as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Push replica changes while you work. Revoking this does not delete local data.')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Отправлять изменения копии во время работы. Отзыв не удаляет локальные данные.')
    expect(i18n.t(KEY)).not.toBe('Push replica changes while you work. Revoking this does not delete local data.')
    expect(i18n.t(KEY)).not.toMatch(/реплик/i)
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
