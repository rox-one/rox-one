import { describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '../setupI18n'

const KEYS = [
  'knowledge.agent.openSessionBrief',
  'inspector.empty.backlinks.body',
] as const

const INTERPOLATION = { mention: '@doc', title: 'Title' }

describe('P35-118 leftover backlinks/Knowledge wrapping', () => {
  it('Russian copy drops leftover English wrapping and keeps interpolation', async () => {
    await setupI18n().changeLanguage('ru')

    const brief = i18n.t('knowledge.agent.openSessionBrief', INTERPOLATION)
    expect(brief).toContain('@doc')
    expect(brief).toContain('Title')
    expect(brief).toContain('обратные ссылки')
    expect(brief).not.toMatch(/\bbacklinks\b/i)

    const body = i18n.t('inspector.empty.backlinks.body')
    expect(body).toContain('База знаний')
    expect(body).not.toMatch(/\bKnowledge\b/)

    for (const key of KEYS) {
      expect(i18n.t(key)).not.toBe(key)
    }
  })

  it('English copy still uses backlinks/Knowledge wrapping', async () => {
    await setupI18n().changeLanguage('en')

    const brief = i18n.t('knowledge.agent.openSessionBrief', INTERPOLATION)
    expect(brief).toContain('@doc')
    expect(brief).toContain('Title')
    expect(brief).toMatch(/\bbacklinks\b/)
    expect(brief).not.toContain('обратные ссылки')

    const body = i18n.t('inspector.empty.backlinks.body')
    expect(body).toMatch(/\bKnowledge\b/)
    expect(body).not.toContain('База знаний')
  })
})
