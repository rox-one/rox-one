import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'session.agentTeamsFlagOff',
  'session.agentTeamsPrompt',
  'settings.appearance.harnessSkip.agentTeamsRuntime',
] as const

const EN: Record<(typeof keys)[number], string> = {
  'session.agentTeamsFlagOff': 'Enable Agent Teams in Appearance → Workbench first.',
  'session.agentTeamsPrompt':
    '@agent-teams Plan a captain-led team for this goal. Stage the roster and task DAG; wait for approval before spawn_session.',
  'settings.appearance.harnessSkip.agentTeamsRuntime': 'Agent-teams runtime',
}

const RU: Record<(typeof keys)[number], string> = {
  'session.agentTeamsFlagOff': 'Сначала включите Команды агентов в Внешний вид → Верстак.',
  'session.agentTeamsPrompt':
    '@agent-teams Составьте план команды с капитаном для этой цели. Сначала состав и DAG задач; не вызывайте spawn_session до одобрения.',
  'settings.appearance.harnessSkip.agentTeamsRuntime': 'Runtime команд агентов',
}

describe('agent-teams leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBe(EN[key])
      expect(ru[key], key).toBe(RU[key])
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['session.agentTeamsFlagOff']).not.toContain('Agent Teams')
    expect(ru['session.agentTeamsFlagOff']).not.toContain('Workbench')
    expect(ru['session.agentTeamsPrompt']).not.toContain('roster')
    expect(ru['settings.appearance.harnessSkip.agentTeamsRuntime']).not.toBe('Runtime agent-teams')
    expect(ru['settings.appearance.harnessSkip.agentTeamsRuntime']).not.toBe('Agent-teams runtime')
  })

  it('setupI18n ru is not English; en stays English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
    }
    expect(i18n.t('session.agentTeamsFlagOff')).not.toContain('OMP')
    expect(i18n.t('session.agentTeamsFlagOff')).not.toContain('oh-my-pi')
    expect(i18n.t('session.agentTeamsFlagOff')).not.toContain('Craft Agents')
    expect(i18n.t('session.agentTeamsFlagOff')).not.toContain('Vercel')
    expect(i18n.t('session.agentTeamsFlagOff')).not.toContain('1M')

    await setupI18n().changeLanguage('en')
    for (const key of keys) {
      expect(i18n.t(key)).toBe(EN[key])
    }
  })
})
