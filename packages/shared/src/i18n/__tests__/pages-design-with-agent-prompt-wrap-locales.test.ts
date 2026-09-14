import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'pages.designWithAgentPrompt'
const RU =
  'Сверстай страницу «{{name}}» (slug: {{slug}}). Она есть в рабочем пространстве, но пока без содержимого — напиши index.html через update_page по гайду Pages.'
const EN =
  'Design the page "{{name}}" (slug: {{slug}}). It exists in my workspace but has no content yet — author its index.html with update_page, following the Pages authoring guide.'

describe('P35-146 leftover workspace wrapping in pages.designWithAgentPrompt', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/workspace/i)
    expect(i18n.t(KEY)).toContain('{{name}}')
    expect(i18n.t(KEY)).toContain('{{slug}}')
  })

  it('changeLanguage(ru) drops leftover воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU)
    expect(ru).toMatch(/рабоч/i)
    expect(ru).not.toMatch(/[Вв]оркспейс/)
    expect(ru).not.toMatch(/\bworkspace\b/i)
    expect(ru).toContain('{{name}}')
    expect(ru).toContain('{{slug}}')
    expect(ru).toContain('Pages')
    expect(ru).not.toBe(EN)
  })
})
