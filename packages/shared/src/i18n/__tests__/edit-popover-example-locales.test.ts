import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEYS = [
  'editPopover.example.editStatuses',
  'editPopover.example.editViews',
] as const

const ENGLISH = {
  'editPopover.example.editStatuses': 'Add a "Blocked" status',
  'editPopover.example.editViews': 'Add a "Stale" view for sessions inactive > 7 days',
} as const

const RUSSIAN = {
  'editPopover.example.editStatuses': 'Добавь статус «Заблокировано»',
  'editPopover.example.editViews': 'Добавь представление «Устаревшие» для сессий без активности более 7 дней',
} as const

describe('editPopover.example leftover status/view names', () => {
  it('Russian copy drops leftover English names; English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RUSSIAN[key])
      expect(i18n.t(key)).not.toBe(ENGLISH[key])
      expect(i18n.t(key)).not.toMatch(/Blocked|Stale/)
    }

    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(ENGLISH[key])
    }
  })
})
