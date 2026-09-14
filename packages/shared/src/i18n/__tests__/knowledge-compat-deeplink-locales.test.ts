import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const keys = ['knowledge.openCompat', 'knowledge.surface.copy.deepLink', 'siyuan.openCompat'] as const

const EN: Record<(typeof keys)[number], string> = {
  'knowledge.openCompat': 'Open compatibility view',
  'knowledge.surface.copy.deepLink': 'Copy deep link',
  'siyuan.openCompat': 'Open SiYuan compatibility view',
}

const RU: Record<(typeof keys)[number], string> = {
  'knowledge.openCompat': 'Открыть режим совместимости',
  'knowledge.surface.copy.deepLink': 'Копировать глубокую ссылку',
  'siyuan.openCompat': 'Открыть режим совместимости SiYuan',
}

describe('P35-100 knowledge compat view and deep link leftovers', () => {
  it('keeps English copy unchanged', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(i18n.t(key)).toBe(EN[key])
    }
    expect(en['knowledge.openCompat']).toContain('compatibility view')
    expect(en['knowledge.surface.copy.deepLink']).toContain('deep link')
    expect(en['siyuan.openCompat']).toContain('compatibility view')
  })

  it('setupI18n ru is not leftover English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(ru[key], key).toBe(RU[key])
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['knowledge.openCompat']).not.toContain('compatibility view')
    expect(ru['knowledge.openCompat']).toContain('режим совместимости')
    expect(ru['knowledge.surface.copy.deepLink']).not.toContain('deep link')
    expect(ru['knowledge.surface.copy.deepLink']).toContain('глубокую ссылку')
    expect(ru['siyuan.openCompat']).not.toContain('compatibility view')
    expect(ru['siyuan.openCompat']).toContain('режим совместимости')
    expect(ru['siyuan.openCompat']).toContain('SiYuan')
    expect(i18n.t('knowledge.openCompat')).not.toContain('OMP')
    expect(i18n.t('knowledge.openCompat')).not.toContain('Craft Agents')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })

  it('wires compat and deep-link keys in all locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of keys) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
