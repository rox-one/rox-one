import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const KEYS = ['common.slug', 'mindmap.live'] as const

describe('P35-121 leftover Slug/Live labels', () => {
  it('keeps the keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })

  it("changeLanguage('en') still English", async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('common.slug')).toBe('Slug')
    expect(i18n.t('mindmap.live')).toBe('Live')
  })

  it("changeLanguage('ru') is not leftover English", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('common.slug')).toBe('Слаг')
    expect(i18n.t('mindmap.live')).toBe('Живая')
    expect(i18n.t('common.slug')).not.toBe('Slug')
    expect(i18n.t('mindmap.live')).not.toBe('Live')
    expect(i18n.t('pages.kind.live')).toBe('Живая')
  })
})
