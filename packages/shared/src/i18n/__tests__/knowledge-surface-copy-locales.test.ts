import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'knowledge.surface.copy.blockKramdown',
  'knowledge.surface.copy.deepLink',
  'knowledge.surface.copy.markdown',
] as const

const EN = {
  'knowledge.surface.copy.blockKramdown': 'Copy block kramdown',
  'knowledge.surface.copy.deepLink': 'Copy deep link',
  'knowledge.surface.copy.markdown': 'Copy markdown',
} as const

const RU = {
  'knowledge.surface.copy.blockKramdown': 'Копировать kramdown блока',
  'knowledge.surface.copy.deepLink': 'Копировать глубокую ссылку',
  'knowledge.surface.copy.markdown': 'Копировать markdown',
} as const

describe('P35-117 leftover knowledge.surface.copy locales', () => {
  it('keeps Russian copy wrapping distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
      expect(ru[key], key).not.toMatch(/\bCopy\b/)
      expect(ru[key], key).not.toMatch(/deep link/)
      expect(ru[key], key).not.toMatch(/oh-my-pi|OMP|Craft Agents/)
    }
    expect(ru['knowledge.surface.copy.blockKramdown']).toContain('kramdown')
    expect(ru['knowledge.surface.copy.markdown']).toContain('markdown')
  })

  it('changeLanguage ru is not leftover English wrapping; en stays English', async () => {
    setupI18n()

    await i18n.changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key), key).toBe(RU[key])
      expect(i18n.t(key), key).not.toBe(EN[key])
      expect(i18n.t(key), key).not.toMatch(/deep link/)
      expect(i18n.t(key), key).not.toMatch(/\bCopy\b/)
    }

    await i18n.changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key), key).toBe(EN[key])
    }
  })
})
