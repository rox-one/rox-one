import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
const INPUT = readFileSync(join(import.meta.dir, '../ApiKeyInput.tsx'), 'utf8')

const WIRED_KEYS = [
  'apiSetup.accessKeyId',
  'apiSetup.secretAccessKey',
  'apiSetup.iamAccessKeyRequired',
  'apiSetup.iamSecretKeyRequired',
] as const

const ADJACENT_LABELS = ['apiSetup.sessionTokenOptional'] as const

describe('P35-96 apiSetup IAM field labels are i18n', () => {
  it('wires Access Key / Secret Access Key labels and IAM required copy through t()', () => {
    expect(INPUT).toContain("t('apiSetup.accessKeyId')")
    expect(INPUT).toContain("t('apiSetup.secretAccessKey')")
    expect(INPUT).toContain("t('apiSetup.iamAccessKeyRequired')")
    expect(INPUT).toContain("t('apiSetup.iamSecretKeyRequired')")
    expect(INPUT).not.toMatch(/defaultValue:\s*['"]Access Key ID['"]/)
    expect(INPUT).not.toMatch(/defaultValue:\s*['"]Secret Access Key['"]/)
  })

  it('English locale keeps the AWS-style field labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('apiSetup.accessKeyId')).toBe('Access Key ID')
    expect(i18n.t('apiSetup.secretAccessKey')).toBe('Secret Access Key')
    expect(i18n.t('apiSetup.iamAccessKeyRequired')).toBe(
      'Access Key ID is required for IAM authentication.',
    )
    expect(i18n.t('apiSetup.iamSecretKeyRequired')).toBe(
      'Secret Access Key is required for IAM authentication.',
    )
    expect(i18n.t('apiSetup.sessionTokenOptional')).toBe('Session Token · optional')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('apiSetup.accessKeyId')).toBe('ID ключа доступа')
    expect(i18n.t('apiSetup.secretAccessKey')).toBe('Секретный ключ доступа')
    expect(i18n.t('apiSetup.iamAccessKeyRequired')).toBe(
      'Для аутентификации IAM требуется ID ключа доступа.',
    )
    expect(i18n.t('apiSetup.iamSecretKeyRequired')).toBe(
      'Для аутентификации IAM требуется секретный ключ доступа.',
    )
    expect(i18n.t('apiSetup.sessionTokenOptional')).toBe('Токен сессии · необязательно')
    expect(i18n.t('apiSetup.accessKeyId')).not.toBe('Access Key ID')
    expect(i18n.t('apiSetup.secretAccessKey')).not.toBe('Secret Access Key')
    expect(i18n.t('apiSetup.sessionTokenOptional')).not.toBe('Session Token · optional')
  })

  it('all 12 locales already define the wired IAM keys', () => {
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
      const catalog = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<
        string,
        string
      >
      for (const key of [...WIRED_KEYS, ...ADJACENT_LABELS]) {
        expect(catalog[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
