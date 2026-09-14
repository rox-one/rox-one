import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'chat.permissionShadow.allow',
  'chat.permissionShadow.deny',
  'chat.permissionShadow.hint',
  'chat.permissionShadow.timeout',
  'chat.permissionShadow.unverified',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'chat.permissionShadow.allow': 'Shadow review: allow',
  'chat.permissionShadow.deny': 'Shadow review: deny',
  'chat.permissionShadow.hint': 'You still choose Allow or Deny',
  'chat.permissionShadow.timeout': 'Shadow review timed out',
  'chat.permissionShadow.unverified': 'Shadow review not configured',
}

const RU: Record<(typeof keys)[number], string> = {
  'chat.permissionShadow.allow': 'Теневое ревью: разрешить',
  'chat.permissionShadow.deny': 'Теневое ревью: запретить',
  'chat.permissionShadow.hint': '«Разрешить» и «Запретить» по-прежнему нажимаете вы',
  'chat.permissionShadow.timeout': 'Теневое ревью истекло',
  'chat.permissionShadow.unverified': 'Теневое ревью не настроено',
}

describe('P35-102 permission-shadow leftover chrome locales', () => {
  it('keeps English copy unchanged', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(i18n.t(key)).toBe(EN[key])
    }
    expect(en['chat.permissionShadow.hint']).toContain('Allow or Deny')
  })

  it('setupI18n ru is not leftover English mix; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(ru[key], key).toBe(RU[key])
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['chat.permissionShadow.hint']).not.toContain('Allow')
    expect(ru['chat.permissionShadow.hint']).not.toContain('Deny')
    expect(ru['chat.permissionShadow.hint']).toContain('Разрешить')
    expect(ru['chat.permissionShadow.hint']).toContain('Запретить')
    expect(ru['chat.permissionShadow.allow']).toContain('разрешить')
    expect(ru['chat.permissionShadow.deny']).toContain('запретить')
    expect(i18n.t('chat.permissionShadow.hint')).not.toContain('OMP')
    expect(i18n.t('chat.permissionShadow.hint')).not.toContain('Craft Agents')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })

  it('wires permission-shadow keys in all locales', () => {
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
