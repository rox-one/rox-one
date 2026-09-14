import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const enSource = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ruSource = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const PROSE_KEYS = [
  'extensions.developer.urlAllowlistTitle',
  'extensions.disabled.empty',
  'extensions.host.status',
] as const

const EN_PROSE = {
  'extensions.developer.urlAllowlistTitle': 'URL allowlist',
  'extensions.disabled.empty': 'No disabled extensions.',
  'extensions.host.status': 'Extension Host: {{status}}',
} as const

const RU_PROSE = {
  'extensions.developer.urlAllowlistTitle': 'Список разрешённых URL',
  'extensions.disabled.empty': 'Нет отключённых расширений.',
  'extensions.host.status': 'Хост расширений: {{status}}',
} as const

describe('P35-86 extensions disabled/host/developer leftover Russian prose', () => {
  it('keeps English source English', () => {
    for (const key of PROSE_KEYS) {
      expect(enSource[key], key).toBe(EN_PROSE[key])
    }
  })

  it('stores distinct Russian prose in ru.json', () => {
    for (const key of PROSE_KEYS) {
      expect(ruSource[key], key).toBe(RU_PROSE[key])
      expect(ruSource[key], key).not.toBe(enSource[key])
    }
  })

  it('avoids OMP / Craft Agents / Vercel in this cluster', () => {
    for (const key of PROSE_KEYS) {
      expect(ruSource[key], key).not.toMatch(/oh-my-pi|OMP|Craft Agents|Vercel/i)
    }
  })

  it('resolves Russian strings after changeLanguage(ru)', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of PROSE_KEYS) {
      expect(i18n.t(key), key).toBe(RU_PROSE[key])
      expect(i18n.t(key), key).not.toBe(EN_PROSE[key])
    }
  })

  it('still resolves English strings after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of PROSE_KEYS) {
      expect(i18n.t(key), key).toBe(EN_PROSE[key])
    }
  })
})
