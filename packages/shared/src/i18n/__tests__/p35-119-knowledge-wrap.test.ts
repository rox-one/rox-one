import { describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '../setupI18n'

const KEYS = [
  'inspector.empty.agent.body',
  'inspector.empty.outline.body',
  'rail.knowledgeDisabled',
] as const

describe('P35-119 leftover Knowledge wrapping in inspector/rail', () => {
  it('Russian copy drops leftover English Knowledge wrapping', async () => {
    await setupI18n().changeLanguage('ru')

    for (const key of KEYS) {
      const value = i18n.t(key)
      expect(value, key).not.toBe(key)
      expect(value, key).toContain('База знаний')
      expect(value, key).not.toMatch(/\bKnowledge\b/)
    }

    expect(i18n.t('inspector.empty.agent.body')).toBe(
      'Инспектор Rox-агента появится с рабочей областью «База знаний» (волна W2). Контекстные действия над документами и блоками будут здесь.',
    )
    expect(i18n.t('inspector.empty.outline.body')).toBe(
      'Структура документа и сессии появится с рабочей областью «База знаний» (волна W2).',
    )
    expect(i18n.t('rail.knowledgeDisabled')).toBe(
      '«База знаний» — появится с рабочей областью «База знаний» (волна W2)',
    )
  })

  it('English copy still uses Knowledge wrapping', async () => {
    await setupI18n().changeLanguage('en')

    for (const key of KEYS) {
      const value = i18n.t(key)
      expect(value, key).not.toBe(key)
      expect(value, key).toMatch(/\bKnowledge\b/)
      expect(value, key).not.toContain('База знаний')
    }

    expect(i18n.t('inspector.empty.agent.body')).toBe(
      'The Rox agent inspector comes with the Knowledge workspace (wave W2). Context actions over documents and blocks will appear here.',
    )
    expect(i18n.t('inspector.empty.outline.body')).toBe(
      'Document and session structure comes with the Knowledge workspace (wave W2).',
    )
    expect(i18n.t('rail.knowledgeDisabled')).toBe(
      'Knowledge — comes with the Knowledge workspace (wave W2)',
    )
  })
})
