import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const messaging = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const WIRED_KEYS = [
  'settings.messaging.telegram.access.pending.allow',
  'settings.messaging.telegram.access.pending.allowForBinding',
  'settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist',
  'settings.messaging.telegram.access.pending.audit.notOwner',
  'settings.messaging.telegram.access.pending.ignore',
] as const

function read(rel: string): string {
  return readFileSync(join(messaging, rel), 'utf8')
}

describe('PendingSendersList leftover English chrome is i18n', () => {
  it('uses catalog keys and skips English defaultValue leftovers', () => {
    const pending = read('access/PendingSendersList.tsx')

    expect(pending).toContain(
      "t('settings.messaging.telegram.access.pending.allowForBinding')",
    )
    expect(pending).toContain("t('settings.messaging.telegram.access.pending.allow')")
    expect(pending).toContain("t('settings.messaging.telegram.access.pending.ignore')")
    expect(pending).toContain(
      "'settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist'",
    )
    expect(pending).toContain(
      "'settings.messaging.telegram.access.pending.audit.notOwner'",
    )
    expect(pending).toContain('userId: sender.userId')
    expect(pending).not.toMatch(/defaultValue:\s*['"]/)
    expect(pending).not.toContain('defaultValue: isBindingScoped')
    expect(pending).not.toContain(
      'Rejected on this chat. Allow adds this exact sender id to the binding allow-list.',
    )
    expect(pending).not.toContain(
      'Rejected as a workspace non-owner. Allow adds this exact sender id as an owner.',
    )
  })

  it('English locale keeps the existing pending-sender copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.messaging.telegram.access.pending.allow')).toBe('Allow')
    expect(i18n.t('settings.messaging.telegram.access.pending.allowForBinding')).toBe(
      'Allow for this chat',
    )
    expect(i18n.t('settings.messaging.telegram.access.pending.ignore')).toBe('Ignore')
    expect(
      i18n.t('settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist'),
    ).toBe('Rejected on this chat. Allow adds this exact sender id to the binding allow-list.')
    expect(i18n.t('settings.messaging.telegram.access.pending.audit.notOwner')).toBe(
      'Rejected as a workspace non-owner. Allow adds this exact sender id as an owner.',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.messaging.telegram.access.pending.allow')).toBe('Разрешить')
    expect(i18n.t('settings.messaging.telegram.access.pending.allowForBinding')).toBe(
      'Разрешить для этого чата',
    )
    expect(i18n.t('settings.messaging.telegram.access.pending.ignore')).toBe('Игнорировать')
    expect(
      i18n.t('settings.messaging.telegram.access.pending.audit.notOnBindingAllowlist'),
    ).toBe(
      'Отклонён в этом чате. Разрешить добавляет этот точный id отправителя в список доступа привязки.',
    )
    expect(i18n.t('settings.messaging.telegram.access.pending.audit.notOwner')).toBe(
      'Отклонён как не-владелец рабочего пространства. Разрешить добавляет этот точный id отправителя как владельца.',
    )
    expect(i18n.t('settings.messaging.telegram.access.pending.allow')).not.toBe('Allow')
  })

  it('all 12 locales define the wired pending-sender keys', () => {
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
      for (const key of WIRED_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
