import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import { CLI_COMMAND_CATALOG } from '@craft-agent/shared/cli'
import i18n from 'i18next'

const renderer = join(import.meta.dir, '../../..')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const NATIVE_LABEL_KEYS = [
  'cli.command.compact.label',
  'cli.command.undo.label',
  'cli.command.share.label',
  'cli.command.join.label',
  'cli.command.export.label',
  'cli.command.vibe.label',
] as const

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('slash command menu native labels are i18n', () => {
  it('uses catalog label keys and skips English leftover labels', () => {
    const slash = read('components/ui/slash-command-menu.tsx')

    expect(slash).toContain('t(catalog.labelKey)')
    expect(slash).toContain("t(`mode.${command.id}`)")
    expect(slash).not.toContain('Compact Context')
    expect(slash).not.toContain('Undo Last Message')
    expect(slash).not.toContain("label: 'Share'")
    expect(slash).not.toContain("label: 'Join'")
    expect(slash).not.toContain("label: 'Export'")
    expect(slash).not.toContain("label: 'Vibe'")
    expect(slash).not.toContain('Summarize conversation context to free up token budget')
    expect(slash).not.toContain('Publish a read-only session link')
    expect(slash).not.toContain('t(catalog.labelKey, command.label)')
    expect(slash).not.toContain('t(`mode.${command.id}`, command.label)')
  })

  it('catalog native commands keep existing label keys', () => {
    const byId = Object.fromEntries(CLI_COMMAND_CATALOG.map((entry) => [entry.id, entry]))
    expect(byId.compact?.labelKey).toBe('cli.command.compact.label')
    expect(byId.undo?.labelKey).toBe('cli.command.undo.label')
    expect(byId.share?.labelKey).toBe('cli.command.share.label')
    expect(byId.join?.labelKey).toBe('cli.command.join.label')
    expect(byId.export?.labelKey).toBe('cli.command.export.label')
    expect(byId.vibe?.labelKey).toBe('cli.command.vibe.label')
  })

  it('English locale keeps the existing slash labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('cli.command.compact.label')).toBe('Compact context')
    expect(i18n.t('cli.command.undo.label')).toBe('Undo last message')
    expect(i18n.t('cli.command.share.label')).toBe('Share')
    expect(i18n.t('cli.command.join.label')).toBe('Join session')
    expect(i18n.t('cli.command.export.label')).toBe('Export session')
    expect(i18n.t('cli.command.vibe.label')).toBe('Vibe')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('cli.command.compact.label')).toBe('Сжать контекст')
    expect(i18n.t('cli.command.undo.label')).toBe('Отменить последнее сообщение')
    expect(i18n.t('cli.command.share.label')).toBe('Поделиться')
    expect(i18n.t('cli.command.compact.label')).not.toBe('Compact context')
  })

  it('all 12 locales already define the wired slash label keys', () => {
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
      for (const key of NATIVE_LABEL_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
