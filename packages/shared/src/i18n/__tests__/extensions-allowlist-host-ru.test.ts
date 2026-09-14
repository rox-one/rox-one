import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const enSource = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ruSource = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const PROSE_KEYS = [
  'extensions.developer.body',
  'extensions.developer.noHosts',
  'extensions.developer.urlAllowlistEmpty',
  'extensions.developer.urlAllowlistHint',
  'extensions.developer.urlAllowlistSave',
  'extensions.host.noSiyuanExec',
] as const

const EN_PROSE = {
  'extensions.developer.body':
    'Per-workspace Extension Hosts run craft-sandbox modules in a utilityProcess. Configure network.request URL allowlists here. SiYuan plugins are never executed in the host.',
  'extensions.developer.noHosts': 'No extension hosts started',
  'extensions.developer.urlAllowlistEmpty': 'Warning: no URL allowlist — all URLs allowed',
  'extensions.developer.urlAllowlistHint':
    'Allowed URL prefixes for network.request / proxyFetch. Empty allowlist allows all URLs (dev default).',
  'extensions.developer.urlAllowlistSave': 'Save allowlist',
  'extensions.host.noSiyuanExec': 'SiYuan plugins run inside SiYuan runtime, not Extension Host',
} as const

const RU_PROSE = {
  'extensions.developer.body':
    'Для каждой рабочей области хост расширений запускает модули craft-sandbox в изолированном процессе. Здесь задаётся список разрешённых URL для network.request. Плагины SiYuan в этом хосте не выполняются.',
  'extensions.developer.noHosts': 'Нет запущенных хостов расширений',
  'extensions.developer.urlAllowlistEmpty':
    'Предупреждение: нет списка разрешённых URL — разрешены все URL',
  'extensions.developer.urlAllowlistHint':
    'Разрешённые префиксы URL для network.request / proxyFetch. Пустой список разрешает все URL (по умолчанию в режиме разработки).',
  'extensions.developer.urlAllowlistSave': 'Сохранить список',
  'extensions.host.noSiyuanExec':
    'Плагины SiYuan выполняются в среде SiYuan, не в хосте расширений',
} as const

describe('P35-87 extensions developer allowlist/host leftover Russian prose', () => {
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

  it('avoids leftover English allowlist / Extension Host / workspace / utilityProcess / OMP copy', () => {
    for (const key of PROSE_KEYS) {
      expect(ruSource[key], key).not.toMatch(/oh-my-pi|OMP|Craft Agents|Vercel/i)
      expect(ruSource[key], key).not.toMatch(/\ballowlist\b/i)
      expect(ruSource[key], key).not.toMatch(/Extension Host/)
      expect(ruSource[key], key).not.toMatch(/\bworkspace\b/)
      expect(ruSource[key], key).not.toMatch(/utilityProcess/)
      expect(ruSource[key], key).not.toMatch(/\bruntime\b/)
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
