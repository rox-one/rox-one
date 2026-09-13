import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const settingsDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const PAGES_041_052 = [
  'AccountSettingsPage.tsx',
  'PrivacySettingsPage.tsx',
  'RuntimeSettingsPage.tsx',
  'CloudRunsSettingsPage.tsx',
  'SecuritySettingsPage.tsx',
  'ContextSettingsPage.tsx',
  'MarketplaceSettingsPage.tsx',
  'KnowledgeSettingsPage.tsx',
  'ExtensionsSettingsPage.tsx',
  'ImportSettingsPage.tsx',
  'AppSettingsPage.tsx',
  'AiSettingsPage.tsx',
  'AppearanceSettingsPage.tsx',
  'InputSettingsPage.tsx',
] as const

function source(file: string): string {
  return readFileSync(join(settingsDir, file), 'utf8')
}

describe('ROX2-041..052 leftover English chrome', () => {
  it('has no native select and no leftover English string defaultValue', () => {
    for (const file of PAGES_041_052) {
      const text = source(file)
      expect(text, file).not.toContain('<select')
      expect(text, file).not.toMatch(/defaultValue:\s*['"]/)
    }
  })

  it('AI credential fallback and unknown provider go through existing t() keys', () => {
    const ai = source('AiSettingsPage.tsx')
    expect(ai).not.toContain('Credential issue detected.')
    expect(ai).not.toContain("|| 'Unknown'")
    expect(ai).toContain('t("settings.ai.credentialIssue")')
    expect(ai).toContain('t("common.unknown")')
  })

  it('keeps Russian copy distinct for the wired leftover keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(12)
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(en['settings.ai.credentialIssue']).toBe('Credential Issue Detected')
    expect(ru['settings.ai.credentialIssue']).toBe('Обнаружена проблема с учётными данными')
    expect(en['common.unknown']).toBe('Unknown')
    expect(ru['common.unknown']).toBe('Неизвестно')
    expect(ru['settings.ai.credentialIssue']).not.toBe(en['settings.ai.credentialIssue'])
    expect(ru['common.unknown']).not.toBe(en['common.unknown'])
  })
})
