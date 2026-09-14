import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const EXPLORE_LEFTOVER_KEYS = [
  'editPopover.example.sourcePermissions',
  'editPopover.example.workspacePermissions',
  'settings.permissions.aboutText1',
  'settings.permissions.aboutText2',
  'settings.permissions.defaultPermissionsDesc',
  'settings.permissions.description',
  'sidebar.view.exploreDesc',
] as const

describe('P35-107 leftover Explore copy', () => {
  it('English locale keeps Explore as the mode name', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('editPopover.example.sourcePermissions')).toBe('Allow list operations in Explore mode')
    expect(i18n.t('editPopover.example.workspacePermissions')).toBe("Allow running 'make build' in Explore mode")
    expect(i18n.t('settings.permissions.description')).toBe('Explore mode rules')
    expect(i18n.t('sidebar.view.exploreDesc')).toBe('Sessions in Explore (read-only) mode')
    expect(i18n.t('editPopover.example.sourcePermissions')).toContain('Explore')
  })

  it('Russian copy uses Обзор and is not leftover English Explore', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('editPopover.example.sourcePermissions')).toBe(
      'Разреши операции чтения списков в режиме Обзор',
    )
    expect(i18n.t('editPopover.example.workspacePermissions')).toBe(
      "Разреши запуск 'make build' в режиме Обзор",
    )
    expect(i18n.t('settings.permissions.aboutText1')).toBe(
      'Разрешения определяют степень автономии агента. В режиме Обзор агент может только читать и исследовать — идеально, чтобы понять проблему до внесения изменений. Когда будете готовы, переключитесь в режим Выполнение, чтобы агент самостоятельно реализовал план.',
    )
    expect(i18n.t('settings.permissions.aboutText2')).toBe(
      'Хороший рабочий процесс: начните в режиме Обзор, чтобы агент исследовал задачу, проверьте предложенный план, затем выполняйте с уверенностью.',
    )
    expect(i18n.t('settings.permissions.defaultPermissionsDesc')).toBe(
      'Шаблоны уровня приложения, разрешённые в режиме Обзор. Команды не из этого списка блокируются.',
    )
    expect(i18n.t('settings.permissions.description')).toBe('Правила режима Обзор')
    expect(i18n.t('sidebar.view.exploreDesc')).toBe('Сессии в режиме Обзор (только чтение)')
    expect(i18n.t('sidebar.view.explore')).toBe('Обзор')

    for (const key of EXPLORE_LEFTOVER_KEYS) {
      expect(i18n.t(key), key).not.toMatch(/\bExplore\b/)
      expect(i18n.t(key), key).not.toBe(en[key])
      expect(ru[key], key).not.toMatch(/\bExplore\b/)
    }
  })
})
