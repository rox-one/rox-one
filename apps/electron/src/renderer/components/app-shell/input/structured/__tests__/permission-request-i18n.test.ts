import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const source = readFileSync(join(import.meta.dir, '../PermissionRequest.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'chat.permission.allow',
  'chat.permission.alwaysAllow',
  'chat.permission.deny',
  'chat.permission.sessionTip',
  'chat.permission.tool',
] as const

describe('P35-103 PermissionRequest leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(source).not.toMatch(/defaultValue:\s*['"]/)
    expect(source).not.toContain("defaultValue: 'Allow'")
    expect(source).not.toContain("defaultValue: 'Always Allow'")
    expect(source).not.toContain("defaultValue: 'Deny'")
    expect(source).not.toContain("defaultValue: 'Tool:'")
  })

  it('keeps t() callsites on the permission chrome keys', () => {
    expect(source).toContain("t('chat.permissionRequired')")
    expect(source).toContain("t('chat.permission.tool')")
    expect(source).toContain("t('chat.permission.allow')")
    expect(source).toContain("t('chat.permission.alwaysAllow')")
    expect(source).toContain("t('chat.permission.deny')")
    expect(source).toContain("t('chat.permission.sessionTip')")
    expect(source).not.toContain("t('chat.permissionShadow.allow')")
    expect(source).not.toContain("t('chat.permissionShadow.deny')")
  })

  it('skips hardcoded English chrome literals', () => {
    expect(source).not.toContain('>Tool:</span>')
    expect(source).not.toContain('"Always Allow" remembers this command for the session')
    expect(source).not.toMatch(/^\s+Allow$/m)
    expect(source).not.toMatch(/^\s+Always Allow$/m)
    expect(source).not.toMatch(/^\s+Deny$/m)
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('chat.permission.tool')).toBe('Tool:')
    expect(i18n.t('chat.permission.allow')).toBe('Allow')
    expect(i18n.t('chat.permission.alwaysAllow')).toBe('Always Allow')
    expect(i18n.t('chat.permission.deny')).toBe('Deny')
    expect(i18n.t('chat.permission.sessionTip')).toBe(
      '"Always Allow" remembers this command for the session',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('chat.permission.tool')).toBe('Инструмент:')
    expect(i18n.t('chat.permission.allow')).toBe('Разрешить')
    expect(i18n.t('chat.permission.alwaysAllow')).toBe('Всегда разрешать')
    expect(i18n.t('chat.permission.deny')).toBe('Запретить')
    expect(i18n.t('chat.permission.sessionTip')).toBe(
      '«Всегда разрешать» запоминает эту команду на сессию',
    )
    expect(i18n.t('chat.permission.allow')).not.toBe('Allow')
    expect(i18n.t('chat.permission.alwaysAllow')).not.toBe('Always Allow')
    expect(i18n.t('chat.permission.deny')).not.toBe('Deny')
    expect(i18n.t('chat.permission.sessionTip')).not.toContain('Always Allow')
    expect(i18n.t('chat.permission.sessionTip')).not.toContain('OMP')
    expect(i18n.t('chat.permission.sessionTip')).not.toContain('Craft Agents')
  })

  it('wires static keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      const keys = Object.keys(locale)
      expect(keys, file).toEqual([...keys].sort())
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
        expect(locale[key], `${file} ${key}`).not.toBe(key)
      }
    }
  })
})
