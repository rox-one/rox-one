import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const page = readFileSync(join(import.meta.dir, '../ConationShellSettings.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'settings.appearance.conationBoard',
  'settings.appearance.conationBoardDesc',
  'settings.appearance.conationCanvas',
  'settings.appearance.conationCanvasDesc',
  'settings.appearance.conationDssClient',
  'settings.appearance.conationDssClientDesc',
  'settings.appearance.conationNotesBridge',
  'settings.appearance.conationNotesBridgeDesc',
  'settings.appearance.conationSessionApply',
  'settings.appearance.conationSessionApplyDesc',
  'settings.appearance.conationSessionApplyHonesty',
  'settings.appearance.conationSoupClient',
  'settings.appearance.conationSoupClientDesc',
] as const

const LOCALE_FILES = [
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
] as const

describe('P35-66 ConationShellSettings leftover chrome is i18n', () => {
  it('does not inject English string leftovers as t() second args', () => {
    expect(page).not.toContain("t('settings.appearance.conationSoupClient', 'Soup client')")
    expect(page).not.toContain("t('settings.appearance.conationNotesBridge', 'Notes bridge')")
    expect(page).not.toContain("t('settings.appearance.conationDssClient', 'DSS client')")
    expect(page).not.toContain("t('settings.appearance.conationSessionApply', 'SessionApply (Conation)')")
    expect(page).not.toContain("t('settings.appearance.conationCanvas', 'Fund canvas deep-link')")
    expect(page).not.toContain("t('settings.appearance.conationBoard', 'Board deep-link')")
    expect(page).not.toContain('Read-only Conation Soup GraphQL client')
    expect(page).not.toContain('Read-only Conation Notes bridge')
    expect(page).not.toContain('Read-only Conation DSS/Drive HTTP client')
    expect(page).not.toContain('HTTP 202 is transport-accepted, not business-completed')
    expect(page).not.toContain('Open Fund canvas on Conation via deep-link')
    expect(page).not.toContain('Open Board on Conation via deep-link')
    expect(page).not.toMatch(/t\([^)]+,\s*['"]/)
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('keeps t() callsites on catalog keys', () => {
    expect(page).toContain("t('settings.appearance.conationSoupClient')")
    expect(page).toContain("t('settings.appearance.conationSoupClientDesc')")
    expect(page).toContain("t('settings.appearance.conationNotesBridge')")
    expect(page).toContain("t('settings.appearance.conationNotesBridgeDesc')")
    expect(page).toContain("t('settings.appearance.conationDssClient')")
    expect(page).toContain("t('settings.appearance.conationDssClientDesc')")
    expect(page).toContain("t('settings.appearance.conationSessionApply')")
    expect(page).toContain("t('settings.appearance.conationSessionApplyDesc')")
    expect(page).toContain("t('settings.appearance.conationSessionApplyHonesty')")
    expect(page).toContain("t('settings.appearance.conationCanvas')")
    expect(page).toContain("t('settings.appearance.conationCanvasDesc')")
    expect(page).toContain("t('settings.appearance.conationBoard')")
    expect(page).toContain("t('settings.appearance.conationBoardDesc')")
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.appearance.conationSoupClient')).toBe('Soup client')
    expect(i18n.t('settings.appearance.conationSoupClientDesc')).toBe(
      'Read-only Conation Soup GraphQL client (workbench.conation.soupClient). Default off.',
    )
    expect(i18n.t('settings.appearance.conationNotesBridge')).toBe('Notes bridge')
    expect(i18n.t('settings.appearance.conationNotesBridgeDesc')).toBe(
      'Read-only Conation Notes bridge (workbench.conation.notesBridge). Default off.',
    )
    expect(i18n.t('settings.appearance.conationDssClient')).toBe('DSS client')
    expect(i18n.t('settings.appearance.conationDssClientDesc')).toBe(
      'Read-only Conation DSS/Drive HTTP client (workbench.conation.dssClient). Default off.',
    )
    expect(i18n.t('settings.appearance.conationSessionApply')).toBe('SessionApply (Conation)')
    expect(i18n.t('settings.appearance.conationSessionApplyDesc')).toBe(
      'SessionApply consumer stub linked to AgentTeamsStore (workbench.conation.sessionApply). Default off. Not Cordis.',
    )
    expect(i18n.t('settings.appearance.conationSessionApplyHonesty')).toBe(
      'HTTP 202 is transport-accepted, not business-completed. No receipt or readback.',
    )
    expect(i18n.t('settings.appearance.conationCanvas')).toBe('Fund canvas deep-link')
    expect(i18n.t('settings.appearance.conationCanvasDesc')).toBe(
      'Open Fund canvas on Conation via deep-link (workbench.conation.canvas). Default off. No live in-pane until Perf.',
    )
    expect(i18n.t('settings.appearance.conationBoard')).toBe('Board deep-link')
    expect(i18n.t('settings.appearance.conationBoardDesc')).toBe(
      'Open Board on Conation via deep-link (workbench.conation.board). Default off. No second in-pane kanban.',
    )
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.appearance.conationSoupClient')).toBe('Клиент Soup')
    expect(i18n.t('settings.appearance.conationSoupClient')).not.toBe('Soup client')
    expect(i18n.t('settings.appearance.conationCanvas')).not.toBe('Fund canvas deep-link')
    expect(i18n.t('settings.appearance.conationBoard')).not.toBe('Board deep-link')
    expect(i18n.t('settings.appearance.conationSessionApplyHonesty')).not.toBe(
      'HTTP 202 is transport-accepted, not business-completed. No receipt or readback.',
    )
  })

  it('wires static keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([...LOCALE_FILES])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
