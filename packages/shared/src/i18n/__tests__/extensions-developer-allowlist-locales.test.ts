import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'extensions.developer.body',
  'extensions.developer.urlAllowlistEmpty',
  'extensions.developer.urlAllowlistHint',
  'extensions.developer.urlAllowlistSave',
] as const

const EN = {
  'extensions.developer.body':
    'Per-workspace Extension Hosts run craft-sandbox modules in a utilityProcess. Configure network.request URL allowlists here. SiYuan plugins are never executed in the host.',
  'extensions.developer.urlAllowlistEmpty': 'Warning: no URL allowlist — all URLs allowed',
  'extensions.developer.urlAllowlistHint':
    'Allowed URL prefixes for network.request / proxyFetch. Empty allowlist allows all URLs (dev default).',
  'extensions.developer.urlAllowlistSave': 'Save allowlist',
} as const

const RU = {
  'extensions.developer.body':
    'Для каждой рабочей области хост расширений запускает модули craft-sandbox в изолированном процессе. Здесь задаётся список разрешённых URL для network.request. Плагины SiYuan в этом хосте не выполняются.',
  'extensions.developer.urlAllowlistEmpty':
    'Предупреждение: нет списка разрешённых URL — разрешены все URL',
  'extensions.developer.urlAllowlistHint':
    'Разрешённые префиксы URL для network.request / proxyFetch. Пустой список разрешает все URL (по умолчанию в режиме разработки).',
  'extensions.developer.urlAllowlistSave': 'Сохранить список',
} as const

describe('P35-116 leftover extensions developer allowlist locales', () => {
  it('keeps Russian allowlist/body copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
      expect(ru[key], key).not.toMatch(/\ballowlist\b/i)
      expect(ru[key], key).not.toMatch(/Extension Host/)
      expect(ru[key], key).not.toMatch(/\bworkspace\b/)
      expect(ru[key], key).not.toMatch(/utilityProcess/)
      expect(ru[key], key).not.toMatch(/\bdev\b/)
      expect(ru[key], key).not.toMatch(/oh-my-pi|OMP|Craft Agents/)
    }
  })

  it('changeLanguage ru is not leftover English; en stays English', async () => {
    setupI18n()

    await i18n.changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key), key).toBe(RU[key])
      expect(i18n.t(key), key).not.toBe(EN[key])
      expect(i18n.t(key), key).not.toMatch(/\ballowlist\b/i)
    }

    await i18n.changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key), key).toBe(EN[key])
    }
  })
})
