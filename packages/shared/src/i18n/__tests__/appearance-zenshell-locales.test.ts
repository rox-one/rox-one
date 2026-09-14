import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'settings.appearance.zenShell',
  'settings.appearance.zenShellEnable',
  'settings.appearance.workbenchHarnessAgentTeams',
  'settings.appearance.harnessSkip.agentTeamsRuntimeDesc',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'settings.appearance.zenShell': 'Zen Shell',
  'settings.appearance.zenShellEnable': 'Enable Zen Shell',
  'settings.appearance.workbenchHarnessAgentTeams': 'Agent Teams',
  'settings.appearance.harnessSkip.agentTeamsRuntimeDesc':
    'Cordis plugin stays out. Opt-in Rox skill is Appearance → Agent Teams (workbench.harness.agentTeams).',
}

const RU: Record<(typeof keys)[number], string> = {
  'settings.appearance.zenShell': 'Дзен-оболочка',
  'settings.appearance.zenShellEnable': 'Включить дзен-оболочку',
  'settings.appearance.workbenchHarnessAgentTeams': 'Команды агентов',
  'settings.appearance.harnessSkip.agentTeamsRuntimeDesc':
    'Cordis-плагин не ставим. Встроенный навык — Внешний вид → Команды агентов (workbench.harness.agentTeams).',
}

describe('appearance zenShell + agent teams leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['settings.appearance.zenShell']).not.toContain('Zen Shell')
    expect(ru['settings.appearance.zenShellEnable']).not.toContain('Zen Shell')
    expect(ru['settings.appearance.workbenchHarnessAgentTeams']).not.toBe('Agent Teams')
    expect(ru['settings.appearance.harnessSkip.agentTeamsRuntimeDesc']).not.toContain('Agent Teams')
    expect(ru['settings.appearance.harnessSkip.agentTeamsRuntimeDesc']).not.toContain('First-party')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('settings.appearance.zenShell')).not.toContain('OMP')
    expect(i18n.t('settings.appearance.workbenchHarnessAgentTeams')).not.toContain('Craft Agents')
    expect(i18n.t('settings.appearance.zenShellEnable')).not.toContain('Vercel')
    expect(i18n.t('settings.appearance.zenShell')).not.toContain('1M')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })
})
