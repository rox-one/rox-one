import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const enSource = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ruSource = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const PROSE_KEYS = [
  'extensions.card.installTarget',
  'extensions.card.noPermissions',
  'extensions.card.permissions',
  'extensions.card.readOnly',
  'extensions.card.runtime',
  'extensions.card.worksIn',
  'extensions.catalog.count',
  'extensions.catalog.empty',
  'extensions.installed.count',
  'extensions.installed.empty',
  'extensions.permissions.empty',
  'extensions.permissions.summary',
  'extensions.updates.empty',
] as const

const EN_PROSE = {
  'extensions.card.installTarget': 'Install to',
  'extensions.card.noPermissions': 'No permissions',
  'extensions.card.permissions': 'Permissions',
  'extensions.card.readOnly': 'projection',
  'extensions.card.runtime': 'Runtime',
  'extensions.card.worksIn': 'Works in',
  'extensions.catalog.count': '{{count}} catalog entries',
  'extensions.catalog.empty': 'No catalog entries match.',
  'extensions.installed.count': '{{count}} installed',
  'extensions.installed.empty': 'No installed extensions in this workspace yet.',
  'extensions.permissions.empty': 'No extensions installed.',
  'extensions.permissions.summary': 'Granted permissions by extension',
  'extensions.updates.empty': 'No updates available.',
} as const

const RU_PROSE = {
  'extensions.card.installTarget': 'Установить в',
  'extensions.card.noPermissions': 'Нет разрешений',
  'extensions.card.permissions': 'Разрешения',
  'extensions.card.readOnly': 'Проекция',
  'extensions.card.runtime': 'Рантайм',
  'extensions.card.worksIn': 'Работает в',
  'extensions.catalog.count': '{{count}} в каталоге',
  'extensions.catalog.empty': 'Нет совпадений в каталоге.',
  'extensions.installed.count': '{{count}} установлено',
  'extensions.installed.empty': 'В этой рабочей области пока нет установленных расширений.',
  'extensions.permissions.empty': 'Нет установленных расширений.',
  'extensions.permissions.summary': 'Выданные разрешения по расширениям',
  'extensions.updates.empty': 'Нет доступных обновлений.',
} as const

describe('P35-84 extensions card/catalog/installed/permissions/updates Russian prose', () => {
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
